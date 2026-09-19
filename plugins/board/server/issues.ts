import httpErrors from "http-errors";
import { RequestError } from "octokit";
import { AuthorizationError, NotFoundError } from "@server/errors";
import type { User } from "@server/models";
import type { IssueChange } from "../shared/columns";
import type { BoardData, BoardIssue, BoardWriteResult } from "../shared/types";
import { BoardRepository } from "../shared/types";
import type { BoardSnapshot } from "./cache";
import { BoardCache } from "./cache";
import { BoardGitHub } from "./github";
import type { GitHubLinkToken } from "./link";
import { GitHubLink } from "./link";

/** An issue as read from GitHub, with the body its deadline is written in. */
export type IssueWithBody = BoardIssue & { body: string | null };

/** How to change an issue, and how to tell afterwards that GitHub did change it. */
export type IssueWrite = {
  plan: (
    issue: IssueWithBody
  ) => IssueChange | { assignees: string[] } | undefined;
  applied: (issue: BoardIssue) => boolean;
};

/**
 * Returns the GitHub link of the user, refusing the request when there is none.
 *
 * @param user the Outline user.
 * @param feature the page the message names, like "la board".
 * @returns the user token and GitHub login.
 * @throws {AuthorizationError} when the user never linked GitHub.
 */
export async function requireLink(
  user: User,
  feature: string
): Promise<GitHubLinkToken> {
  const link = await GitHubLink.token(user);
  if (!link) {
    throw AuthorizationError(`Collega GitHub per usare ${feature}`);
  }
  return link;
}

/**
 * Reads the issues, shared by every page and every user of the process.
 *
 * @returns the last read of GitHub, marked stale when GitHub did not answer.
 * @throws when GitHub does not answer and nothing was ever read.
 */
export async function readIssues(): Promise<
  BoardSnapshot & { stale: boolean }
> {
  try {
    return await BoardCache.read();
  } catch {
    throw unavailable();
  }
}

/**
 * Builds the answer the board and the calendar both read, so they never disagree
 * on what the issues are.
 *
 * @param link the GitHub link of the user asking.
 * @param snapshot the issues as last read from GitHub.
 * @returns the payload of the list endpoints.
 */
export function issuesPayload(
  link: GitHubLinkToken,
  snapshot: BoardSnapshot & { stale: boolean }
): BoardData {
  return {
    repository: `${BoardRepository.owner}/${BoardRepository.name}`,
    viewer: { login: link.login },
    issues: snapshot.issues,
    people: snapshot.people,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    stale: snapshot.stale,
  };
}

/**
 * Writes to an issue as the user only if it did not change on GitHub since the page read it.
 *
 * @param user the Outline user, whose link is dropped when GitHub rejects the token.
 * @param token the user access token.
 * @param number the issue number.
 * @param seenUpdatedAt the updatedAt the page saw.
 * @param write how to change the issue and how to check the change landed.
 * @returns the outcome and the issue as read again from GitHub.
 */
export async function writeIssue(
  user: User,
  token: string,
  number: number,
  seenUpdatedAt: string,
  { plan, applied }: IssueWrite
): Promise<BoardWriteResult> {
  return withGitHubErrors(user, async () => {
    const current = await BoardGitHub.readIssue(token, number);
    if (Date.parse(current.issue.updatedAt) !== Date.parse(seenUpdatedAt)) {
      BoardCache.replaceIssue(current.issue);
      return { result: "conflict", issue: current.issue };
    }

    const change = plan({ ...current.issue, body: current.body });
    if (!change) {
      return { result: "ok", issue: current.issue };
    }

    try {
      await BoardGitHub.updateIssue(token, number, change);
    } catch (err) {
      if (err instanceof RequestError && [403, 422].includes(err.status)) {
        return { result: "rejected", issue: current.issue };
      }
      throw err;
    }

    // Without push access GitHub drops labels and assignees without an error: only a new read tells.
    const updated = await BoardGitHub.readIssue(token, number);
    BoardCache.replaceIssue(updated.issue);
    return {
      result: applied(updated.issue) ? "ok" : "rejected",
      issue: updated.issue,
    };
  });
}

/**
 * Turns the failures of GitHub into answers the page can act on.
 *
 * @param user the Outline user, unlinked when GitHub refuses the token.
 * @param fn the call to GitHub.
 * @returns whatever the call returns.
 */
export async function withGitHubErrors<T>(
  user: User,
  fn: () => Promise<T>
): Promise<T> {
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
      throw AuthorizationError("Collega di nuovo GitHub");
    }
    if (err.status === 404) {
      throw NotFoundError("Issue non trovata su GitHub");
    }
    throw unavailable();
  }
}

/** The answer given when GitHub is unreachable, so the page can say so and retry. */
export function unavailable() {
  return httpErrors(503, "GitHub non risponde", { id: "github_unavailable" });
}
