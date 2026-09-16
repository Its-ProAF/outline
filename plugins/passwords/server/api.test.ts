import { Password } from "@server/models";
import {
  buildApiKey,
  buildGuestUser,
  buildUser,
  buildViewer,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
const values = {
  site: "https://example.com",
  username: "alice",
  password: "fake-test-secret",
  notes: "Test notes",
};

describe("password manager", () => {
  it("creates encrypted entries, lists without secrets, reads, updates and deletes", async () => {
    const user = await buildUser();
    const created = await server.post("/api/passwords.create", user, {
      body: values,
    });
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { data: entry } = await created.json();
    expect(entry.password).toBeUndefined();
    const stored = await Password.findByPk(entry.id, { rejectOnEmpty: true });
    expect(stored.sealed.toString()).not.toContain(values.password);
    expect(stored.sealed.toString()).not.toContain(values.username);
    expect(stored.open()).toEqual(values);
    const listing = await server.post("/api/passwords.list", user, {
      body: {},
    });
    const page = await listing.json();
    expect(page.data.entries).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain(values.password);
    const read = await server.post("/api/passwords.info", user, {
      body: { id: entry.id },
    });
    expect((await read.json()).data.password).toBe(values.password);
    const updated = await server.post("/api/passwords.update", user, {
      body: { id: entry.id, version: entry.version, username: "bob" },
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).data.version).toBe(2);
    await stored.reload();
    expect(stored.open()).toEqual({ ...values, username: "bob" });
    const conflict = await server.post("/api/passwords.update", user, {
      body: { id: entry.id, version: 1, password: "overwrite" },
    });
    expect(conflict.status).toBe(409);
    const staleDelete = await server.post("/api/passwords.delete", user, {
      body: { id: entry.id, version: 1 },
    });
    expect(staleDelete.status).toBe(409);
    const removed = await server.post("/api/passwords.delete", user, {
      body: { id: entry.id, version: 2 },
    });
    expect(removed.status).toBe(200);
    expect(await Password.findByPk(entry.id)).toBeNull();
  });

  it("blocks other workspaces, guests, anonymous access and viewer writes", async () => {
    const user = await buildUser();
    const created = await server.post("/api/passwords.create", user, {
      body: values,
    });
    const { data: entry } = await created.json();
    const other = await buildUser();
    const guest = await buildGuestUser({ teamId: user.teamId });
    const viewer = await buildViewer({ teamId: user.teamId });
    expect(
      (await server.post("/api/passwords.list", { body: {} })).status
    ).toBe(401);
    expect(
      (await server.post("/api/passwords.list", guest, { body: {} })).status
    ).toBe(403);
    expect(
      (
        await server.post("/api/passwords.info", guest, {
          body: { id: entry.id },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await server.post("/api/passwords.info", other, {
          body: { id: entry.id },
        })
      ).status
    ).toBe(404);
    expect(
      (
        await server.post("/api/passwords.update", other, {
          body: { id: entry.id, version: 1, notes: "bad" },
        })
      ).status
    ).toBe(404);
    expect(
      (
        await server.post("/api/passwords.delete", other, {
          body: { id: entry.id, version: 1 },
        })
      ).status
    ).toBe(404);
    expect(
      (await server.post("/api/passwords.create", viewer, { body: values }))
        .status
    ).toBe(403);
    expect(
      (
        await server.post("/api/passwords.update", viewer, {
          body: { id: entry.id, version: 1, notes: "bad" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await server.post("/api/passwords.delete", viewer, {
          body: { id: entry.id, version: 1 },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await server.post("/api/passwords.info", viewer, {
          body: { id: entry.id },
        })
      ).status
    ).toBe(200);
  });

  it("rejects unsafe URLs and invalid or excessive input", async () => {
    const user = await buildUser();
    for (const site of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hello",
      "not-a-url",
    ]) {
      expect(
        (
          await server.post("/api/passwords.create", user, {
            body: { ...values, site },
          })
        ).status
      ).toBe(400);
    }
    expect(
      (
        await server.post("/api/passwords.create", user, {
          body: { ...values, password: "" },
        })
      ).status
    ).toBe(400);
    expect(
      (await server.post("/api/passwords.list", user, { body: { limit: 101 } }))
        .status
    ).toBe(400);
  });

  it("authenticates ciphertext and binds it to the record and workspace", async () => {
    const user = await buildUser();
    const a = Password.build({ teamId: user.teamId, version: 1 });
    const b = Password.build({ teamId: user.teamId, version: 1 });
    a.seal(values);
    b.seal(values);
    expect(a.sealed.equals(b.sealed)).toBe(false);
    b.sealed = a.sealed;
    expect(() => b.open()).toThrow();
    a.sealed = Buffer.from(a.sealed);
    a.sealed[30] ^= 1;
    expect(() => a.open()).toThrow();
  });

  it("enforces scoped API keys", async () => {
    const user = await buildUser();
    const key = await buildApiKey({
      userId: user.id,
      scope: ["passwords:read"],
    });
    const headers = { Authorization: `Bearer ${key.value}` };
    expect(
      (await server.post("/api/passwords.list", { headers, body: {} })).status
    ).toBe(200);
    expect(
      (
        await server.post("/api/passwords.create", {
          headers,
          body: values,
        })
      ).status
    ).toBe(403);
  });
});
