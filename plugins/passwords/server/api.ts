import Router from "koa-router";
import type { z } from "zod";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { BaseSchema } from "@server/routes/api/schema";
import type { APIContext } from "@server/types";
import {
  PasswordFields,
  PasswordListInput,
  PasswordRef,
  PasswordUpdateInput,
  PasswordVersionRef,
} from "../shared/schema";
import { PasswordService } from "./service";

const router = new Router();

/** Installs a validated credential endpoint without caching sensitive responses. */
function endpoint<T extends z.ZodType>(
  name: string,
  body: T,
  handler: (
    ctx: APIContext<z.infer<ReturnType<typeof schema<T>>>>
  ) => Promise<object>
) {
  router.post(
    `passwords.${name}`,
    auth(),
    rateLimiter(RateLimiterStrategy.OneThousandPerHour),
    validate(schema(body)),
    async (ctx: APIContext<z.infer<ReturnType<typeof schema<T>>>>) => {
      ctx.set("Cache-Control", "no-store");
      ctx.body = { data: await handler(ctx) };
    }
  );
}

/** Wraps credential input in the API validation envelope. */
function schema<T extends z.ZodType>(body: T) {
  return BaseSchema.extend({ body });
}

endpoint("list", PasswordListInput, (ctx) =>
  PasswordService.list(ctx.state.auth.user, ctx.input.body)
);
endpoint("info", PasswordRef, (ctx) =>
  PasswordService.info(ctx.state.auth.user, ctx.input.body.id)
);
endpoint("create", PasswordFields, (ctx) =>
  PasswordService.create(ctx.state.auth.user, ctx.input.body)
);
endpoint("update", PasswordUpdateInput, (ctx) =>
  PasswordService.update(ctx.state.auth.user, ctx.input.body)
);
endpoint("delete", PasswordVersionRef, (ctx) =>
  PasswordService.delete(ctx.state.auth.user, ctx.input.body)
);

export default router;
