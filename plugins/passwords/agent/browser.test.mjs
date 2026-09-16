import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  beginPasskeyRegistration,
  withPasskey,
  findLogin,
} from "./browser.mjs";

test("dedicated passkey survives a fresh browser context and signs real WebAuthn challenges", async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const origin = "https://passkey.test";
  const entry = {
    id: "test-entry",
    version: 1,
    site: origin,
    username: "agent",
  };
  let saved;
  let releases = 0;
  const api = async (method, input) => {
    if (method === "setPasskey") {
      saved = input.credential;
      return { ...entry, hasPasskey: true };
    }
    if (method === "releasePasskey") {
      releases += 1;
      return { success: true };
    }
    assert.equal(input.origin, origin);
    if (method === "findLogin") {
      return { entries: [entry] };
    }
    assert.equal(method, "passkey");
    const credential = { ...saved };
    saved.signCount += 32;
    return {
      credential,
      origin,
      leaseId: "test-lease",
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      maxAssertions: 32,
    };
  };
  const pageInFreshContext = async () => {
    const context = await browser.newContext();
    assert.deepEqual(await context.cookies(), []);
    await context.route(`${origin}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Local WebAuthn test</title><h1>Passkey test</h1>",
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    return { context, page };
  };
  try {
    const { context, page } = await pageInFreshContext();
    const options = await generateRegistrationOptions({
      rpName: "Local test",
      rpID: "passkey.test",
      userName: "agent",
      supportedAlgorithmIDs: [-7],
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const enrollment = await beginPasskeyRegistration(page, api, entry);
    const response = await page.evaluate(
      async (options) =>
        (
          await navigator.credentials.create({
            publicKey:
              PublicKeyCredential.parseCreationOptionsFromJSON(options),
          })
        ).toJSON(),
      options
    );
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: options.challenge,
      expectedOrigin: origin,
      expectedRPID: "passkey.test",
      requireUserVerification: true,
    });
    assert(verification.verified);
    await enrollment.save();
    assert.equal(saved.signCount, 1);
    await context.close();
    for (let i = 0; i < 2; i++) {
      const fresh = await pageInFreshContext();
      const login = await findLogin(fresh.page, api, "agent");
      const request = await generateAuthenticationOptions({
        rpID: "passkey.test",
        userVerification: "required",
      });
      const assertion = await withPasskey(fresh.page, api, login, () =>
        fresh.page.evaluate(
          async (request) =>
            (
              await navigator.credentials.get({
                publicKey:
                  PublicKeyCredential.parseRequestOptionsFromJSON(request),
              })
            ).toJSON(),
          request
        )
      );
      const verified = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: request.challenge,
        expectedOrigin: origin,
        expectedRPID: "passkey.test",
        credential: verification.registrationInfo.credential,
        requireUserVerification: true,
      });
      assert(verified.verified);
      assert.equal(verified.authenticationInfo.newCounter, 2 + i * 32);
      verification.registrationInfo.credential.counter =
        verified.authenticationInfo.newCounter;
      await fresh.context.close();
    }
    const failed = await pageInFreshContext();
    await assert.rejects(
      withPasskey(failed.page, api, entry, async () => {
        throw new Error("Target login failed");
      }),
      /Target login failed/
    );
    assert.equal(releases, 3);
    await failed.context.close();
  } finally {
    await browser.close();
  }
});
