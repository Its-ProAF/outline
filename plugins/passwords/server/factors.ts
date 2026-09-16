import { createHmac, createPrivateKey, randomUUID } from "node:crypto";
import httpErrors from "http-errors";
import type { z } from "zod";
import { Password, type User } from "@server/models";
import { authorize } from "@server/policies";
import { NotFoundError } from "@server/errors";
import { sequelize } from "@server/storage/database";
import {
  TotpConfig,
  type PasskeyCredential,
  type StoredPasswordValues,
  type TotpSaveInput,
  type PasskeySaveInput,
  type FactorReadInput,
  type FindLoginInput,
} from "../shared/schema";
import { PasswordService } from "./service";

function decodeBase32(secret: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  if (bits && value & ((1 << bits) - 1)) {
    throw new Error("Invalid Base32 padding");
  }
  return Buffer.from(bytes);
}

/** Parses a setup key or otpauth URI without including the secret in errors. */
export function parseTotp(configuration: string): z.infer<typeof TotpConfig> {
  try {
    let secret = configuration.trim();
    let algorithm = "SHA1";
    let digits = 6;
    let period = 30;
    if (secret.startsWith("otpauth://")) {
      const uri = new URL(secret);
      if (uri.hostname !== "totp" || uri.username || uri.password || uri.hash) {
        throw new Error();
      }
      secret = uri.searchParams.get("secret") || "";
      algorithm = (
        uri.searchParams.get("algorithm") || algorithm
      ).toUpperCase();
      digits = Number(uri.searchParams.get("digits") || digits);
      period = Number(uri.searchParams.get("period") || period);
    }
    const config = TotpConfig.parse({
      secret: secret.replace(/\s/g, "").replace(/=+$/, "").toUpperCase(),
      algorithm,
      digits,
      period,
    });
    decodeBase32(config.secret);
    return config;
  } catch {
    throw httpErrors(
      400,
      "Configurazione TOTP non valida. Usa la chiave Base32 o un URI otpauth://totp."
    );
  }
}

/** Generates an RFC 6238 code and its exact expiry. */
export function generateTotp(
  config: z.infer<typeof TotpConfig>,
  now = Date.now()
) {
  const counter = Math.floor(now / 1000 / config.period);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(
    config.algorithm.toLowerCase(),
    decodeBase32(config.secret)
  )
    .update(message)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return {
    code: String(number % 10 ** config.digits).padStart(config.digits, "0"),
    expiresAt: new Date((counter + 1) * config.period * 1000).toISOString(),
  };
}

/** Requires the configured HTTPS login origin before disclosing a factor. */
export function checkLoginOrigin(values: StoredPasswordValues, origin: string) {
  const requested = new URL(origin);
  const expected = new URL(values.loginUrl || values.site);
  if (
    requested.protocol !== "https:" ||
    requested.origin !== expected.origin ||
    requested.username ||
    requested.password
  ) {
    throw httpErrors(
      400,
      "Il dominio non corrisponde al link di login salvato."
    );
  }
}

function validatePasskey(
  values: StoredPasswordValues,
  credential: z.infer<typeof PasskeyCredential>
) {
  try {
    const url = new URL(values.loginUrl || values.site);
    const rp = credential.rpId;
    if (
      url.protocol !== "https:" ||
      rp !== rp.toLowerCase() ||
      !rp.includes(".") ||
      !/^[a-z0-9.-]+$/.test(rp) ||
      !(url.hostname === rp || url.hostname.endsWith(`.${rp}`))
    ) {
      throw new Error();
    }
    for (const input of [
      credential.privateKey,
      credential.credentialId,
      credential.userHandle,
    ]) {
      if (Buffer.from(input, "base64").toString("base64") !== input) {
        throw new Error();
      }
    }
    if (
      Buffer.from(credential.userHandle, "base64").length > 64 ||
      Buffer.from(credential.credentialId, "base64").length > 1024
    ) {
      throw new Error();
    }
    const key = createPrivateKey({
      key: Buffer.from(credential.privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error();
    }
  } catch {
    throw httpErrors(
      400,
      "Passkey non valida o dominio incompatibile. È richiesta una passkey software ES256 dedicata agli agenti."
    );
  }
}

/** Encrypted second factors shared by API, MCP and browser automation. */
export class LoginFactors {
  /** Finds login metadata by exact origin without disclosing secrets. */
  static async find(user: User, input: z.infer<typeof FindLoginInput>) {
    const origin = new URL(input.origin).origin;
    const matches = [];
    let offset = 0;
    while (true) {
      const page = await PasswordService.list(user, {
        offset,
        limit: 100,
        category: "password",
      });
      for (const entry of page.entries) {
        if (
          new URL(entry.loginUrl || entry.site).origin === origin &&
          (input.username === undefined || entry.username === input.username)
        ) {
          matches.push(entry);
        }
      }
      offset += page.entries.length;
      if (offset >= page.total) {
        return { entries: matches };
      }
    }
  }

  /** Saves or removes a TOTP seed with version checking. */
  static async setTotp(user: User, input: z.infer<typeof TotpSaveInput>) {
    const totp =
      input.configuration === null ? undefined : parseTotp(input.configuration);
    return this.configure(user, input, (values) => ({ ...values, totp }));
  }

  /** Saves or removes a dedicated software passkey. */
  static async setPasskey(user: User, input: z.infer<typeof PasskeySaveInput>) {
    return this.configure(user, input, (values) => {
      if (
        values.passkeyLease &&
        Date.parse(values.passkeyLease.expiresAt) > Date.now()
      ) {
        throw httpErrors(409, "Passkey in uso. Riprova al termine del login.");
      }
      if (input.credential) {
        validatePasskey(values, input.credential);
      }
      return {
        ...values,
        passkey: input.credential ?? undefined,
        passkeyLease: undefined,
      };
    });
  }

  /** Returns only the current OTP and its expiry, never its seed. */
  static async totp(user: User, input: z.infer<typeof FactorReadInput>) {
    const values = await this.read(user, input);
    if (!values.totp) {
      throw httpErrors(404, "TOTP non configurato.");
    }
    return generateTotp(values.totp);
  }

  /** Exports a passkey only for its explicitly requested login origin. */
  static async passkey(user: User, input: z.infer<typeof FactorReadInput>) {
    return sequelize.transaction(async (transaction) => {
      const entry = await Password.findOne({
        where: { id: input.id, teamId: user.teamId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!entry) {
        throw NotFoundError();
      }
      authorize(user, "read", entry);
      const values = entry.open();
      checkLoginOrigin(values, input.origin);
      if (!values.passkey) {
        throw httpErrors(404, "Passkey non configurata.");
      }
      validatePasskey(values, values.passkey);
      if (
        values.passkeyLease &&
        Date.parse(values.passkeyLease.expiresAt) > Date.now()
      ) {
        throw httpErrors(
          409,
          "Passkey in uso da un altro agente. Riprova al termine del login."
        );
      }
      if (values.passkey.signCount > 4294967295 - 32) {
        throw httpErrors(
          409,
          "Contatore passkey esaurito. Registra una nuova passkey."
        );
      }
      const credential = values.passkey;
      const lease = {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      };
      entry.seal({
        ...values,
        passkey: { ...credential, signCount: credential.signCount + 32 },
        passkeyLease: lease,
      });
      entry.version += 1;
      await entry.save({ transaction });
      return {
        credential,
        origin: new URL(input.origin).origin,
        leaseId: lease.id,
        expiresAt: lease.expiresAt,
        maxAssertions: 32,
      };
    });
  }

  /** Releases the caller's browser lease while preserving reserved counter values. */
  static async releasePasskey(
    user: User,
    input: { id: string; leaseId: string }
  ) {
    return sequelize.transaction(async (transaction) => {
      const entry = await Password.findOne({
        where: { id: input.id, teamId: user.teamId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!entry) {
        throw NotFoundError();
      }
      authorize(user, "read", entry);
      const values = entry.open();
      if (values.passkeyLease?.id !== input.leaseId) {
        throw httpErrors(409, "Sessione passkey non più attiva.");
      }
      entry.seal({ ...values, passkeyLease: undefined });
      entry.version += 1;
      await entry.save({ transaction });
      return { success: true };
    });
  }

  private static async read(
    user: User,
    input: z.infer<typeof FactorReadInput>
  ) {
    const entry = await Password.findOne({
      where: { id: input.id, teamId: user.teamId },
    });
    if (!entry) {
      throw NotFoundError();
    }
    authorize(user, "read", entry);
    const values = entry.open();
    checkLoginOrigin(values, input.origin);
    return values;
  }

  private static async configure(
    user: User,
    input: { id: string; version: number },
    change: (values: StoredPasswordValues) => StoredPasswordValues
  ) {
    await sequelize.transaction(async (transaction) => {
      const entry = await Password.findOne({
        where: { id: input.id, teamId: user.teamId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!entry) {
        throw NotFoundError();
      }
      authorize(user, "update", entry);
      if (entry.version !== input.version) {
        throw httpErrors(409, "Voce modificata. Ricarica prima di salvare.");
      }
      if (entry.category !== "password") {
        throw httpErrors(
          400,
          "I fattori richiedono una voce nella sezione Password."
        );
      }
      entry.seal(change(entry.open()));
      entry.version += 1;
      await entry.save({ transaction });
    });
    const { password: _secret, ...metadata } = await PasswordService.info(
      user,
      input.id
    );
    return metadata;
  }
}
