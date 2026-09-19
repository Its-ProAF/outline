import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import {
  generateOAuthStateNonce,
  verifyOAuthStateNonce,
} from "@server/utils/oauth";
import { changeForMove } from "../../shared/columns";
import type { BoardIssue } from "../../shared/types";
import { BoardGitHub } from "../github";
import { issuesPayload, readIssues, requireLink, writeIssue } from "../issues";
import { GitHubLink } from "../link";
import * as T from "./schema";

export const BoardOAuthNonceCookie = "boardGitHubOAuthNonce";

/** The pages GitHub can send the user back to, by the key carried in the OAuth state. */
const ReturnPaths: Record<string, string> = {
  board: "/board",
  calendario: "/calendario",
};

// The nonce is alphanumeric, so this can only come from the page that asked.
const StateSeparator = "~";

const router = new Router();

router.get(
  "board.connect",
  auth(),
  validate(T.BoardConnectSchema),
  (ctx: APIContext<T.BoardConnectReq>) => {
    const { to } = ctx.input.query;
    const nonce = generateOAuthStateNonce(ctx, BoardOAuthNonceCookie);
    ctx.redirect(
      BoardGitHub.authorizeUrl(to ? `${nonce}${StateSeparator}${to}` : nonce)
    );
  }
);

router.get(
  "board.callback",
  auth(),
  validate(T.BoardCallbackSchema),
  async (ctx: APIContext<T.BoardCallbackReq>) => {
    const { code, state, error } = ctx.input.query;
    const separator = state.indexOf(StateSeparator);
    const nonce = separator === -1 ? state : state.slice(0, separator);
    const to = ReturnPaths[state.slice(separator + 1)] ?? ReturnPaths.board;
    verifyOAuthStateNonce(ctx, BoardOAuthNonceCookie, nonce);

    if (error || !code) {
      ctx.redirect(`${to}?error=${encodeURIComponent(error ?? "no_code")}`);
      return;
    }

    const tokens = await BoardGitHub.exchangeCode(code);
    const githubUser = await BoardGitHub.getUser(tokens.access_token);
    await GitHubLink.save(ctx.state.auth.user, tokens, githubUser);
    ctx.redirect(to);
  }
);

router.post("board.list", auth(), async (ctx: APIContext) => {
  const link = await requireLink(ctx.state.auth.user, "la board");
  ctx.body = { data: issuesPayload(link, await readIssues()) };
});

router.post(
  "board.move",
  auth(),
  validate(T.BoardMoveSchema),
  async (ctx: APIContext<T.BoardMoveReq>) => {
    const { number, column, updatedAt } = ctx.input.body;
    const { user } = ctx.state.auth;
    const link = await requireLink(user, "la board");

    ctx.body = {
      data: await writeIssue(user, link.token, number, updatedAt, {
        plan: (issue) => changeForMove(issue, column),
        applied: (issue) => issue.column === column,
      }),
    };
  }
);

router.post(
  "board.assign",
  auth(),
  validate(T.BoardAssignSchema),
  async (ctx: APIContext<T.BoardAssignReq>) => {
    const { number, login, updatedAt } = ctx.input.body;
    const { user } = ctx.state.auth;
    const link = await requireLink(user, "la board");
    const assignees = login ? [login] : [];
    const applied = (issue: BoardIssue) =>
      issue.assignees.length === assignees.length &&
      issue.assignees.every((a) => assignees.includes(a.login));

    ctx.body = {
      data: await writeIssue(user, link.token, number, updatedAt, {
        plan: (issue) => (applied(issue) ? undefined : { assignees }),
        applied,
      }),
    };
  }
);

export default router;
