import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import {
  issuesPayload,
  readIssues,
  requireLink,
  writeIssue,
} from "plugins/board/server/issues";
import { changeForSchedule } from "../../shared/schedule";
import * as T from "./schema";

const Feature = "il calendario";

const router = new Router();

router.post("calendar.list", auth(), async (ctx: APIContext) => {
  const link = await requireLink(ctx.state.auth.user, Feature);
  ctx.body = { data: issuesPayload(link, await readIssues()) };
});

router.post(
  "calendar.schedule",
  auth(),
  validate(T.CalendarScheduleSchema),
  async (ctx: APIContext<T.CalendarScheduleReq>) => {
    const { number, deadline, updatedAt } = ctx.input.body;
    const { user } = ctx.state.auth;
    const link = await requireLink(user, Feature);

    ctx.body = {
      data: await writeIssue(user, link.token, number, updatedAt, {
        plan: (issue) => changeForSchedule(issue, deadline),
        applied: (issue) => issue.deadline === deadline,
      }),
    };
  }
);

export default router;
