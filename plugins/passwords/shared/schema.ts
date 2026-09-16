import { z } from "zod";

export const PasswordFields = z.object({
  site: z.url({ protocol: /^https?$/ }).max(2048),
  username: z.string().max(1024),
  password: z.string().min(1).max(16384),
  notes: z.string().max(16384).default(""),
});
export const PasswordListInput = z.object({
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
});
export type PasswordValues = z.infer<typeof PasswordFields>;
export interface PasswordEntry extends Omit<PasswordValues, "password"> {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
