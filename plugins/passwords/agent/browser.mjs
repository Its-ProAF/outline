/** Creates an HTTPS vault client; keep the API key in the process environment. */
export function createVaultClient({
  url = process.env.OUTLINE_URL,
  token = process.env.OUTLINE_API_KEY,
} = {}) {
  const base = new URL(url);
  if (base.protocol !== "https:" || !token || base.username || base.password) {
    throw new Error(
      "An HTTPS Outline URL and an authorized API key are required"
    );
  }
  return async (method, body) => {
    if (!/^[a-zA-Z]+$/.test(method)) {
      throw new Error("Invalid vault operation");
    }
    const response = await fetch(new URL(`/api/passwords.${method}`, base), {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Vault ${method}: HTTP ${response.status}`);
    }
    return (await response.json()).data;
  };
}

/** Returns a single unambiguous login matching the current page's exact origin. */
export async function findLogin(page, api, username) {
  const origin = new URL(page.url()).origin;
  const { entries } = await api("findLogin", {
    origin,
    ...(username ? { username } : {}),
  });
  if (entries.length !== 1) {
    throw new Error(
      entries.length
        ? "Multiple accounts match; select the requested account"
        : "No login registered for this origin"
    );
  }
  return entries[0];
}

function checkOrigin(page, entry) {
  const expected = new URL(entry.loginUrl || entry.site);
  if (
    expected.protocol !== "https:" ||
    new URL(page.url()).origin !== expected.origin
  ) {
    throw new Error("Browser origin differs from the configured login origin");
  }
  return expected.origin;
}

async function authenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          ctap2Version: "ctap2_1",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
          defaultBackupEligibility: true,
          defaultBackupState: true,
        },
      }
    );
    return {
      cdp,
      authenticatorId,
      async close() {
        try {
          await cdp.send("WebAuthn.removeVirtualAuthenticator", {
            authenticatorId,
          });
        } finally {
          await cdp.detach();
        }
      },
    };
  } catch (error) {
    await cdp.detach();
    throw error;
  }
}

/** Loads one software passkey for one action, then removes it even if login fails. */
export async function withPasskey(page, api, entry, action) {
  const origin = checkOrigin(page, entry);
  const lease = await api("passkey", { id: entry.id, origin });
  let auth;
  let timer;
  let onAssertion;
  try {
    auth = await authenticator(page);
    checkOrigin(page, entry);
    await auth.cdp.send("WebAuthn.addCredential", {
      authenticatorId: auth.authenticatorId,
      credential: lease.credential,
    });
    const remaining = Math.min(
      90000,
      Date.parse(lease.expiresAt) - Date.now() - 5000
    );
    if (remaining <= 0) {
      throw new Error("Passkey lease expired; retry with a fresh lease");
    }
    let assertions = 0;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Passkey login timed out")),
        remaining
      );
      onAssertion = () => {
        assertions += 1;
        if (assertions >= lease.maxAssertions) {
          reject(new Error("Passkey assertion budget exhausted"));
        }
      };
      auth.cdp.on("WebAuthn.credentialAsserted", onAssertion);
    });
    return await Promise.race([action(), deadline]);
  } finally {
    clearTimeout(timer);
    if (auth && onAssertion) {
      auth.cdp.off("WebAuthn.credentialAsserted", onAssertion);
    }
    try {
      if (auth) {
        await auth.close();
      }
    } finally {
      await api("releasePasskey", { id: entry.id, leaseId: lease.leaseId });
    }
  }
}

/** Starts enrollment on the already authenticated target site. Call save after site confirmation.
 * If save fails, keep the browser and this handle alive, then retry save; the key stays in memory.
 * close discards unsaved material and should only be used after saving or cancelling enrollment.
 */
export async function beginPasskeyRegistration(page, api, entry) {
  checkOrigin(page, entry);
  if (entry.hasPasskey) {
    throw new Error(
      "A passkey is already stored; explicitly remove it before replacing it"
    );
  }
  const auth = await authenticator(page);
  return {
    async save(version = entry.version) {
      checkOrigin(page, entry);
      const { credentials } = await auth.cdp.send("WebAuthn.getCredentials", {
        authenticatorId: auth.authenticatorId,
      });
      if (credentials.length !== 1) {
        throw new Error(
          "Register exactly one new passkey on the target site first"
        );
      }
      const source = credentials[0];
      if (
        !source.isResidentCredential ||
        !source.userHandle ||
        source.signCount > 1 ||
        !source.backupEligibility ||
        !source.backupState
      ) {
        throw new Error(
          "Expected a fresh, unused, resident software passkey with backup flags"
        );
      }
      const credential = {
        credentialId: source.credentialId,
        rpId: source.rpId,
        privateKey: source.privateKey,
        userHandle: source.userHandle,
        isResidentCredential: true,
        signCount: source.signCount,
        backupEligibility: true,
        backupState: true,
      };
      const result = await api("setPasskey", {
        id: entry.id,
        version,
        credential,
      });
      await auth.close();
      return result;
    },
    close: () => auth.close(),
  };
}

/** Requests a fresh OTP only while the browser is on the configured login origin. */
export async function getTotp(page, api, entry) {
  return api("totp", { id: entry.id, origin: checkOrigin(page, entry) });
}
