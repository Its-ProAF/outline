import { createAppAuth } from "@octokit/auth-app";
import type { Endpoints } from "@octokit/types";
import { subDays } from "date-fns";
import { Octokit } from "octokit";
import env from "@server/env";
import { NotFoundError } from "@server/errors";
import type { TokenRefreshResponse } from "@server/models/IntegrationAuthentication";
import githubEnv from "plugins/github/server/env";
import type { IssueChange, IssueState } from "../shared/columns";
import { columnFor, labelValue, parseDeadline } from "../shared/columns";
import type { BoardIssue, BoardPerson } from "../shared/types";
import { BoardRepository, DoneDays } from "../shared/types";

const RequestTimeoutMs = 10_000;

export type GitHubUser = { id: number; login: string };

type RestIssue =
  Endpoints["GET /repos/{owner}/{repo}/issues/{issue_number}"]["response"]["data"];

type GraphQLPerson = { login: string; name: string | null; avatarUrl: string };

type GraphQLIssue = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  updatedAt: string;
  closedAt: string | null;
  body: string;
  assignees: { nodes: GraphQLPerson[] };
  milestone: { title: string } | null;
  labels: { nodes: { name: string }[] };
};

type IssuesResponse = {
  repository: {
    issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphQLIssue[];
    };
  };
};

type PeopleResponse = {
  repository: { assignableUsers: { nodes: GraphQLPerson[] } };
};

const IssuesQuery = `query BoardIssues($owner: String!, $name: String!, $states: [IssueState!], $since: DateTime, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor, states: $states, filterBy: { since: $since }, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state updatedAt closedAt body
        assignees(first: 10) { nodes { login name avatarUrl } }
        milestone { title }
        labels(first: 50) { nodes { name } }
      }
    }
  }
}`;

const PeopleQuery = `query BoardPeople($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100) { nodes { login name avatarUrl } }
  }
}`;

const repo = { owner: BoardRepository.owner, repo: BoardRepository.name };

const timeout = () => ({ signal: AbortSignal.timeout(RequestTimeoutMs) });

/** GitHub access for the board: reads as the App installation, writes with the user's token. */
export class BoardGitHub {
  private static auth?: ReturnType<typeof createAppAuth>;
  private static installationId?: number;

  /**
   * Builds a REST and GraphQL client.
   *
   * @param token installation or user access token, omitted for OAuth endpoints.
   * @returns an Octokit client that fails fast instead of retrying.
   */
  static client(token?: string) {
    // Retries would delay the switch to the last read when GitHub is down.
    return new Octokit({
      auth: token,
      retry: { enabled: false },
      throttle: { enabled: false },
    });
  }

  /**
   * Returns an installation token of the GitHub App, cached by auth-app until close to expiry.
   *
   * @returns the installation access token.
   */
  static async installationToken(): Promise<string> {
    const auth = this.appAuth();
    try {
      if (!this.installationId) {
        const app = await auth({ type: "app" });
        const { data } = await this.client(app.token).request(
          "GET /repos/{owner}/{repo}/installation",
          { ...repo, request: timeout() }
        );
        this.installationId = data.id;
      }
      const installation = await auth({
        type: "installation",
        installationId: this.installationId,
      });
      return installation.token;
    } catch (err) {
      this.installationId = undefined;
      throw err;
    }
  }

  /**
   * Reads open issues and issues closed in the last days, plus the people they can be assigned to.
   *
   * @returns the board issues and assignable people.
   */
  static async fetchBoard(): Promise<{
    issues: BoardIssue[];
    people: BoardPerson[];
  }> {
    const octokit = this.client(await this.installationToken());
    const since = subDays(new Date(), DoneDays);
    const [open, closed, people]: [BoardIssue[], BoardIssue[], PeopleResponse] =
      await Promise.all([
        this.fetchIssues(octokit, "OPEN", null),
        this.fetchIssues(octokit, "CLOSED", since.toISOString()),
        octokit.graphql<PeopleResponse>(PeopleQuery, {
          owner: repo.owner,
          name: repo.repo,
          request: timeout(),
        }),
      ]);

    return {
      issues: [
        ...open,
        ...closed.filter((i) => i.closedAt && new Date(i.closedAt) >= since),
      ],
      people: people.repository.assignableUsers.nodes,
    };
  }

  /**
   * Reads a single issue without any cache.
   *
   * @param token the user access token.
   * @param number the issue number.
   * @returns the issue as shown on the board.
   */
  static async getIssue(token: string, number: number): Promise<BoardIssue> {
    const { data }: { data: RestIssue } = await this.client(token).request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}",
      { ...repo, issue_number: number, request: timeout() }
    );
    if (data.pull_request) {
      throw NotFoundError("Not an issue");
    }

    const state: IssueState = data.state === "closed" ? "closed" : "open";
    return buildIssue({
      number: data.number,
      title: data.title,
      url: data.html_url,
      state,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      body: data.body ?? null,
      labels: data.labels.map((l) =>
        typeof l === "string" ? l : (l.name ?? "")
      ),
      assignees: (data.assignees ?? []).map((a) => ({
        login: a.login,
        name: a.name ?? null,
        avatarUrl: a.avatar_url,
      })),
      milestone: data.milestone?.title ?? null,
    });
  }

  /**
   * Updates labels, state or assignees of an issue as the user.
   *
   * @param token the user access token.
   * @param number the issue number.
   * @param change the fields to update.
   */
  static async updateIssue(
    token: string,
    number: number,
    change: IssueChange | { assignees: string[] }
  ) {
    const body =
      "assignees" in change
        ? { assignees: change.assignees }
        : {
            labels: change.labels,
            state: change.state,
            state_reason: change.stateReason,
          };
    await this.client(token).rest.issues.update({
      ...repo,
      issue_number: number,
      ...body,
      request: timeout(),
    });
  }

  /**
   * Returns the GitHub URL where the user authorizes the App to act on their behalf.
   *
   * @param state the OAuth state carrying the CSRF nonce.
   * @returns the authorization URL.
   */
  static authorizeUrl(state: string) {
    const params = new URLSearchParams({
      client_id: githubEnv.GITHUB_CLIENT_ID ?? "",
      redirect_uri: `${env.URL}/api/board.callback`,
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  static exchangeCode(code: string) {
    return this.requestToken({ code });
  }

  static refreshUserToken(refreshToken: string) {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  static async getUser(token: string): Promise<GitHubUser> {
    const { data } = await this.client(token).rest.users.getAuthenticated({
      request: timeout(),
    });
    return { id: data.id, login: data.login };
  }

  private static async requestToken(
    params: Record<string, string>
  ): Promise<TokenRefreshResponse> {
    const { data } = await this.client().request(
      "POST https://github.com/login/oauth/access_token",
      {
        client_id: githubEnv.GITHUB_CLIENT_ID,
        client_secret: githubEnv.GITHUB_CLIENT_SECRET,
        ...params,
        headers: { accept: "application/json" },
        request: timeout(),
      }
    );
    // GitHub answers 200 with an error field when a code or refresh token is invalid.
    if (!data.access_token) {
      throw new Error(
        `GitHub token request failed: ${data.error ?? "unknown"}`
      );
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  }

  private static appAuth() {
    this.auth ??= createAppAuth({
      appId: githubEnv.GITHUB_APP_ID!,
      privateKey: Buffer.from(
        githubEnv.GITHUB_APP_PRIVATE_KEY!,
        "base64"
      ).toString("ascii"),
      clientId: githubEnv.GITHUB_CLIENT_ID,
      clientSecret: githubEnv.GITHUB_CLIENT_SECRET,
    });
    return this.auth;
  }

  private static async fetchIssues(
    octokit: Octokit,
    state: "OPEN" | "CLOSED",
    since: string | null
  ): Promise<BoardIssue[]> {
    const issues: BoardIssue[] = [];
    let cursor: string | null = null;
    do {
      const response: IssuesResponse = await octokit.graphql<IssuesResponse>(
        IssuesQuery,
        {
          owner: repo.owner,
          name: repo.repo,
          states: [state],
          since,
          cursor,
          request: timeout(),
        }
      );
      const page = response.repository.issues;
      issues.push(
        ...page.nodes.map((node) =>
          buildIssue({
            number: node.number,
            title: node.title,
            url: node.url,
            state: node.state === "CLOSED" ? "closed" : "open",
            updatedAt: node.updatedAt,
            closedAt: node.closedAt,
            body: node.body,
            labels: node.labels.nodes.map((l) => l.name),
            assignees: node.assignees.nodes,
            milestone: node.milestone?.title ?? null,
          })
        )
      );
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    return issues;
  }
}

function buildIssue(
  raw: Omit<BoardIssue, "column" | "area" | "type" | "year" | "deadline"> & {
    body: string | null;
  }
): BoardIssue {
  const { body, ...issue } = raw;
  return {
    ...issue,
    column: columnFor(issue),
    area: labelValue(issue.labels, "area:"),
    type: labelValue(issue.labels, "tipo:"),
    year: labelValue(issue.labels, "anno:"),
    deadline: parseDeadline(body),
  };
}
