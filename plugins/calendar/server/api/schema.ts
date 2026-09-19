import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

/** Refuses the days a month does not have, which a regex alone would let through. */
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }, "Giorno inesistente");

export const CalendarScheduleSchema = BaseSchema.extend({
  body: z.object({
    number: z.number().int().positive(),
    /** The updatedAt the page saw, to refuse writes over changes made on GitHub. */
    updatedAt: z.string().min(1),
    /** The new deadline, or null to take it away. */
    deadline: IsoDate.nullable(),
  }),
});

export type CalendarScheduleReq = z.infer<typeof CalendarScheduleSchema>;
