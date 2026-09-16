import { z } from "zod";

export const PasswordCategory = z.enum([
  "password",
  "key",
  "environment",
  "file",
]);

export const PasswordFields = z.object({
  category: PasswordCategory.optional(),
  name: z.string().trim().max(200).optional(),
  site: z.url({ protocol: /^https?$/ }).max(2048),
  loginUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .optional(),
  username: z.string().max(1024),
  password: z.string().max(16384).default(""),
  notes: z.string().max(16384).default(""),
});
export const PasswordListInput = z.object({
  category: PasswordCategory.optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
export const PasswordRef = z.object({ id: z.uuid() });
export const PasswordVersionRef = PasswordRef.extend({
  version: z.number().int().positive(),
});
export const PasswordUpdateInput = PasswordFields.partial().extend({
  ...PasswordVersionRef.shape,
  notes: z.string().max(16384).optional(),
  password: z.string().min(1).max(16384).optional(),
});
export type PasswordValues = z.infer<typeof PasswordFields>;
export type PasswordCategoryValue = z.infer<typeof PasswordCategory>;
export interface PasswordEntry extends Omit<PasswordValues, "password"> {
  hasTotp?: boolean;
  hasPassword?: boolean;
  hasPasskey?: boolean;
  passkeyRpId?: string;
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const TotpConfig = z.object({
  secret: z.string().regex(/^[A-Z2-7]{16,256}$/),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.union([z.literal(6), z.literal(8)]),
  period: z.number().int().min(15).max(120),
});

const base64 = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const PasskeyCredential = z.object({
  credentialId: base64,
  rpId: z.string().min(1).max(253),
  privateKey: base64,
  userHandle: base64.max(88),
  isResidentCredential: z.literal(true),
  signCount: z.number().int().min(0).max(4294967295),
  backupEligibility: z.literal(true),
  backupState: z.literal(true),
});
export const StoredPasswordFields = PasswordFields.extend({
  totp: TotpConfig.optional(),
  passkey: PasskeyCredential.optional(),
  passkeyLease: z
    .object({ id: z.uuid(), expiresAt: z.string().datetime() })
    .optional(),
});
export type StoredPasswordValues = z.infer<typeof StoredPasswordFields>;
export const LoginOrigin = z.object({
  origin: z.url({ protocol: /^https$/ }).max(2048),
});
export const PasskeyReleaseInput = PasswordRef.extend({ leaseId: z.uuid() });
export const FactorReadInput = PasswordRef.extend(LoginOrigin.shape);
export const TotpSaveInput = PasswordVersionRef.extend({
  configuration: z.string().min(1).max(4096).nullable(),
});
export const PasskeySaveInput = PasswordVersionRef.extend({
  credential: PasskeyCredential.nullable(),
});
export const FindLoginInput = LoginOrigin.extend({
  username: z.string().max(1024).optional(),
});
