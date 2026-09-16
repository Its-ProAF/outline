import { generateKeyPairSync } from "node:crypto";
import { Password } from "@server/models";
import {
  buildApiKey,
  buildUser,
  buildGuestUser,
  buildViewer,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { parseTotp, generateTotp } from "./factors";

const server = getTestServer();
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const values = {
  site: "https://mail.example.com",
  loginUrl: "https://accounts.example.com/login",
  username: "test",
  password: "fake-login-secret",
  notes: "Test",
};
function passkey() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    credentialId: Buffer.from("test-credential").toString("base64"),
    rpId: "example.com",
    privateKey: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    userHandle: Buffer.from("test-user").toString("base64"),
    isResidentCredential: true,
    signCount: 1,
    backupEligibility: true,
    backupState: true,
  };
}

describe("login factors", () => {
  it("matches RFC 6238 vectors including timestamps after 2038", () => {
    const config = parseTotp(`otpauth://totp/Test?secret=${seed}&digits=8`);
    for (const [seconds, expected] of [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ] as const) {
      expect(generateTotp(config, seconds * 1000).code).toBe(expected);
    }
    expect(
      generateTotp(
        parseTotp(
          "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&digits=8&algorithm=SHA256"
        ),
        59000
      ).code
    ).toBe("46119246");
    expect(
      generateTotp(
        parseTotp(
          "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA&digits=8&algorithm=SHA512"
        ),
        59000
      ).code
    ).toBe("90693936");
    expect(() => parseTotp("otpauth://hotp/Test?secret=SECRET")).toThrow(
      "Configurazione TOTP non valida"
    );
    expect(() => parseTotp("invalid-secret-input")).toThrow(
      "Configurazione TOTP non valida"
    );
  });

  it("encrypts factors, hides them from metadata and password reads, and preserves them on edits", async () => {
    const user = await buildUser();
    const created = await server.post("/api/passwords.create", user, {
      body: values,
    });
    const { data: entry } = await created.json();
    const otp = await server.post("/api/passwords.setTotp", user, {
      body: { id: entry.id, version: 1, configuration: seed },
    });
    expect(otp.status).toBe(200);
    expect(JSON.stringify(await otp.json())).not.toContain(seed);
    const credential = passkey();
    const saved = await server.post("/api/passwords.setPasskey", user, {
      body: { id: entry.id, version: 2, credential },
    });
    expect(saved.status).toBe(200);
    const changed = await server.post("/api/passwords.update", user, {
      body: { id: entry.id, version: 3, name: "Updated name" },
    });
    expect(changed.status).toBe(200);
    const read = await server.post("/api/passwords.info", user, {
      body: { id: entry.id },
    });
    const info = await read.json();
    expect(info.data).toMatchObject({
      password: values.password,
      hasTotp: true,
      hasPasskey: true,
    });
    expect(JSON.stringify(info)).not.toContain(seed);
    expect(JSON.stringify(info)).not.toContain(credential.privateKey);
    const stored = await Password.findByPk(entry.id, { rejectOnEmpty: true });
    expect(stored.open().totp?.secret).toBe(seed);
    expect(stored.open().passkey?.privateKey).toBe(credential.privateKey);
    expect(stored.sealed.toString()).not.toContain(seed);
    expect(stored.sealed.toString()).not.toContain(credential.privateKey);
    const listing = await server.post("/api/passwords.findLogin", user, {
      body: { origin: "https://accounts.example.com" },
    });
    expect((await listing.json()).data.entries).toHaveLength(1);
    const wrong = await server.post("/api/passwords.findLogin", user, {
      body: { origin: "https://accounts.example.com.evil.test" },
    });
    expect((await wrong.json()).data.entries).toHaveLength(0);
    const exportKey = await server.post("/api/passwords.passkey", user, {
      body: { id: entry.id, origin: "https://accounts.example.com" },
    });
    const exported = (await exportKey.json()).data;
    expect(exported.credential).toEqual(credential);
    const busy = await server.post("/api/passwords.passkey", user, {
      body: { id: entry.id, origin: "https://accounts.example.com" },
    });
    expect(busy.status).toBe(409);
    const released = await server.post("/api/passwords.releasePasskey", user, {
      body: { id: entry.id, leaseId: exported.leaseId },
    });
    expect(released.status).toBe(200);
    const next = await server.post("/api/passwords.passkey", user, {
      body: { id: entry.id, origin: "https://accounts.example.com" },
    });
    expect((await next.json()).data.credential.signCount).toBe(
      credential.signCount + 32
    );
    expect(exportKey.headers.get("cache-control")).toBe("no-store");
    const remove = await server.post("/api/passwords.setTotp", user, {
      body: { id: entry.id, version: 7, configuration: null },
    });
    expect((await remove.json()).data.hasTotp).toBe(false);
    await stored.reload();
    expect(stored.open().passkey).toEqual({
      ...credential,
      signCount: credential.signCount + 64,
    });
  });

  it("enforces origins, scopes, workspace isolation, roles and stale versions", async () => {
    const user = await buildUser();
    const made = await server.post("/api/passwords.create", user, {
      body: values,
    });
    const { data: entry } = await made.json();
    const ref = { id: entry.id, origin: "https://accounts.example.com" };
    expect(
      (
        await server.post("/api/passwords.setTotp", user, {
          body: { id: entry.id, version: 1, configuration: seed },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await server.post("/api/passwords.setTotp", user, {
          body: { id: entry.id, version: 1, configuration: null },
        })
      ).status
    ).toBe(409);
    for (const origin of [
      "https://evil.test",
      "https://accounts.example.com.evil.test",
    ]) {
      expect(
        (
          await server.post("/api/passwords.totp", user, {
            body: { ...ref, origin },
          })
        ).status
      ).toBe(400);
    }
    const other = await buildUser();
    const guest = await buildGuestUser({ teamId: user.teamId });
    const viewer = await buildViewer({ teamId: user.teamId });
    expect(
      (await server.post("/api/passwords.totp", other, { body: ref })).status
    ).toBe(404);
    expect(
      (await server.post("/api/passwords.totp", guest, { body: ref })).status
    ).toBe(403);
    expect(
      (await server.post("/api/passwords.totp", { body: ref })).status
    ).toBe(401);
    expect(
      (
        await server.post("/api/passwords.setTotp", viewer, {
          body: { id: entry.id, version: 2, configuration: null },
        })
      ).status
    ).toBe(403);
    const readKey = await buildApiKey({
      userId: user.id,
      scope: ["passwords:read"],
    });
    const code = await server.post("/api/passwords.totp", {
      body: ref,
      headers: { Authorization: `Bearer ${readKey.value}` },
    });
    expect(code.status).toBe(200);
    expect((await code.json()).data.code).toMatch(/^\d{6}$/);
    const documentKey = await buildApiKey({
      userId: user.id,
      scope: ["documents:read"],
    });
    expect(
      (
        await server.post("/api/passwords.totp", {
          body: ref,
          headers: { Authorization: `Bearer ${documentKey.value}` },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await server.post("/api/passwords.setPasskey", user, {
          body: {
            id: entry.id,
            version: 2,
            credential: { ...passkey(), rpId: "evil.test" },
          },
        })
      ).status
    ).toBe(400);
  });
});
