import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { BoardColumn } from "../../shared/columns";

export const BoardConnectSchema = BaseSchema.extend({
  query: z.object({
    /** The page to go back to once GitHub has answered, "board" when missing. */
    to: z.string().optional(),
  }),
});

export type BoardConnectReq = z.infer<typeof BoardConnectSchema>;

export const BoardCallbackSchema = BaseSchema.extend({
  query: z.object({
    code: z.string().nullish(),
    state: z.string(),
    error: z.string().nullish(),
  }),
});

export type BoardCallbackReq = z.infer<typeof BoardCallbackSchema>;

const IssueRef = {
  number: z.number().int().positive(),
  /** The updatedAt the page saw, to refuse writes over changes made on GitHub. */
  updatedAt: z.string().min(1),
};

export const BoardMoveSchema = BaseSchema.extend({
  body: z.object({
    ...IssueRef,
    column: z.enum(BoardColumn),
  }),
});

export type BoardMoveReq = z.infer<typeof BoardMoveSchema>;

export const BoardAssignSchema = BaseSchema.extend({
  body: z.object({
    ...IssueRef,
    login: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .nullable(),
  }),
});

export type BoardAssignReq = z.infer<typeof BoardAssignSchema>;
