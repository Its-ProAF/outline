import httpErrors from "http-errors";
import Router from "koa-router";
import { RequestError } from "octokit";
import { AuthorizationError, NotFoundError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import type { User } from "@server/models";
import type { APIContext } from "@server/types";
import {
  generateOAuthStateNonce,
  verifyOAuthStateNonce,
} from "@server/utils/oauth";
import type { IssueChange } from "../../shared/columns";
import { changeForMove } from "../../shared/columns";
import type {
  BoardData,
  BoardIssue,
  BoardWriteResult,
} from "../../shared/types";
import { BoardRepository } from "../../shared/types";
import { BoardCache } from "../cache";
import { BoardGitHub } from "../github";
import { GitHubLink } from "../link";
import * as T from "./schema";

export const BoardOAuthNonceCookie = "boardGitHubOAuthNonce";

const router = new Router();

router.get("board.connect", auth(), (ctx: APIContext) => {
  const nonce = generateOAuthStateNonce(ctx, BoardOAuthNonceCookie);
  ctx.redirect(BoardGitHub.authorizeUrl(nonce));
});

router.get(
  "board.callback",
  auth(),
  validate(T.BoardCallbackSchema),
  async (ctx: APIContext<T.BoardCallbackReq>) => {
    const { code, state, error } = ctx.input.query;
    verifyOAuthStateNonce(ctx, BoardOAuthNonceCookie, state);

    if (error || !code) {
      ctx.redirect(`/board?error=${encodeURIComponent(error ?? "no_code")}`);
      return;
    }

    const tokens = await BoardGitHub.exchangeCode(code);
    const githubUser = await BoardGitHub.getUser(tokens.access_token);
    await GitHubLink.save(ctx.state.auth.user, tokens, githubUser);
    ctx.redirect("/board");
  }
);

router.post("board.list", auth(), async (ctx: APIContext) => {
  const link = await requireLink(ctx.state.auth.user);

  let board;
  try {
    board = await BoardCache.read();
  } catch {
    throw unavailable();
  }

  const data: BoardData = {
    repository: `${BoardRepository.owner}/${BoardRepository.name}`,
    viewer: { login: link.login },
    issues: board.issues,
    people: board.people,
    fetchedAt: board.fetchedAt.toISOString(),
    stale: board.stale,
  };
  ctx.body = { data };
});

router.post(
  "board.move",
  auth(),
  validate(T.BoardMoveSchema),
  async (ctx: APIContext<T.BoardMoveReq>) => {
    const { number, column, updatedAt } = ctx.input.body;
    const { user } = ctx.state.auth;
    const link = await requireLink(user);

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
    const link = await requireLink(user);
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

async function requireLink(user: User) {
  const link = await GitHubLink.token(user);
  if (!link) {
    throw AuthorizationError("Collega GitHub per usare la board");
  }
  return link;
}

/**
 * Writes to an issue as the user only if it did not change on GitHub since the page read it.
 *
 * @returns the outcome and the issue as read again from GitHub.
 */
async function writeIssue(
  user: User,
  token: string,
  number: number,
  seenUpdatedAt: string,
  {
    plan,
    applied,
  }: {
    plan: (
      issue: BoardIssue
    ) => IssueChange | { assignees: string[] } | undefined;
    applied: (issue: BoardIssue) => boolean;
  }
): Promise<BoardWriteResult> {
  return withGitHubErrors(user, async () => {
    const current = await BoardGitHub.getIssue(token, number);
    if (Date.parse(current.updatedAt) !== Date.parse(seenUpdatedAt)) {
      BoardCache.replaceIssue(current);
      return { result: "conflict", issue: current };
    }

    const change = plan(current);
    if (!change) {
      return { result: "ok", issue: current };
    }

    try {
      await BoardGitHub.updateIssue(token, number, change);
    } catch (err) {
      if (err instanceof RequestError && [403, 422].includes(err.status)) {
        return { result: "rejected", issue: current };
      }
      throw err;
    }

    // Without push access GitHub drops labels and assignees without an error: only a new read tells.
    const updated = await BoardGitHub.getIssue(token, number);
    BoardCache.replaceIssue(updated);
    return { result: applied(updated) ? "ok" : "rejected", issue: updated };
  });
}

async function withGitHubErrors<T>(user: User, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof RequestError)) {
      if (httpErrors.isHttpError(err)) {
        throw err;
      }
      throw unavailable();
    }
    if (err.status === 401) {
      await GitHubLink.disconnect(user);
      throw AuthorizationError("Collega GitHub per usare la board");
    }
    if (err.status === 404) {
      throw NotFoundError("Issue non trovata su GitHub");
    }
    throw unavailable();
  }
}

function unavailable() {
  return httpErrors(503, "GitHub non risponde", { id: "github_unavailable" });
}

export default router;
