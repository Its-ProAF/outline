import { addHours, addSeconds, subDays } from "date-fns";
import { http, HttpResponse } from "msw";
import { IntegrationService } from "@shared/types";
import type { User } from "@server/models";
import { IntegrationAuthentication } from "@server/models";
import { buildUser } from "@server/test/factories";
import { server as msw } from "@server/test/msw";
import { getTestServer } from "@server/test/support";
import { BoardColumn } from "../../shared/columns";
import { BoardCache } from "../cache";
import { BoardGitHub } from "../github";

const server = getTestServer();

const IssueUrl = "https://api.github.com/repos/Its-ProAF/ProAF/issues/:number";

type RestIssue = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  updated_at: string;
  closed_at: string | null;
  body: string;
  labels: { name: string }[];
  assignees: { login: string; avatar_url: string }[];
  milestone: { title: string } | null;
};

function restIssue(overrides: Partial<RestIssue> = {}): RestIssue {
  return {
    number: 7,
    title: "Issue di prova",
    html_url: "https://github.com/Its-ProAF/ProAF/issues/7",
    state: "open",
    updated_at: "2026-09-15T10:00:00Z",
    closed_at: null,
    body: "Scadenza: 2026-09-30",
    labels: [{ name: "area:agenti" }],
    assignees: [{ login: "fedeinfe", avatar_url: "https://avatars/fedeinfe" }],
    milestone: { title: "Board delle issue" },
    ...overrides,
  };
}

function graphqlIssue(
  number: number,
  overrides: { state?: "OPEN" | "CLOSED"; closedAt?: string; labels?: string[] }
) {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/Its-ProAF/ProAF/issues/${number}`,
    state: overrides.state ?? "OPEN",
    updatedAt: "2026-09-15T10:00:00Z",
    closedAt: overrides.closedAt ?? null,
    body: "",
    assignees: { nodes: [] },
    milestone: null,
    labels: { nodes: (overrides.labels ?? []).map((name) => ({ name })) },
  };
}

/** Serves the board GraphQL queries and counts how many times the board was read. */
function mockBoard(
  open: ReturnType<typeof graphqlIssue>[],
  closed: ReturnType<typeof graphqlIssue>[] = []
) {
  const reads = { count: 0 };
  msw.use(
    http.post("https://api.github.com/graphql", async ({ request }) => {
      const { query, variables } = (await request.json()) as {
        query: string;
        variables: { states?: string[] };
      };
      if (query.includes("BoardPeople")) {
        reads.count++;
        return HttpResponse.json({
          data: {
            repository: {
              assignableUsers: {
                nodes: [
                  { login: "fedeinfe", name: "Federico", avatarUrl: "a" },
                  { login: "IGOLz", name: "Alexandru", avatarUrl: "b" },
                ],
              },
            },
          },
        });
      }
      return HttpResponse.json({
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: variables.states?.[0] === "CLOSED" ? closed : open,
            },
          },
        },
      });
    })
  );
  return reads;
}

/** Serves an issue that reads as `before` until it is patched, then as `after`. */
function mockIssue(before: RestIssue, after: RestIssue = before) {
  const calls = { patches: [] as unknown[], authorizations: [] as string[] };
  let current = before;
  msw.use(
    http.get(IssueUrl, ({ request }) => {
      calls.authorizations.push(request.headers.get("authorization") ?? "");
      return HttpResponse.json(current);
    }),
    http.patch(IssueUrl, async ({ request }) => {
      calls.authorizations.push(request.headers.get("authorization") ?? "");
      calls.patches.push(await request.json());
      current = after;
      return HttpResponse.json(after);
    })
  );
  return calls;
}

async function linkGitHub(user: User) {
  await IntegrationAuthentication.create({
    service: IntegrationService.GitHub,
    userId: user.id,
    teamId: user.teamId,
    token: "user-token",
    refreshToken: "refresh-token",
    expiresAt: addHours(new Date(), 8),
    scopes: ["board", "github_user_id:1", "github_login:fedeinfe"],
  });
}

beforeEach(() => {
  BoardCache.reset();
  vi.spyOn(BoardGitHub, "installationToken").mockResolvedValue(
    "installation-token"
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("#board.list", () => {
  it("returns 403 when the user has not linked GitHub", async () => {
    const user = await buildUser();
    const reads = mockBoard([]);

    const res = await server.post("/api/board.list", user);

    expect(res.status).toEqual(403);
    expect(reads.count).toEqual(0);
  });

  it("returns the issues in their columns", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    mockBoard(
      [
        graphqlIssue(1, { labels: ["area:fisco", "tipo:attività"] }),
        graphqlIssue(2, { labels: ["stato:in-attesa"] }),
      ],
      [
        graphqlIssue(3, {
          state: "CLOSED",
          closedAt: subDays(new Date(), 2).toISOString(),
        }),
        graphqlIssue(4, {
          state: "CLOSED",
          closedAt: subDays(new Date(), 20).toISOString(),
        }),
      ]
    );

    const res = await server.post("/api/board.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.stale).toBe(false);
    expect(body.data.viewer.login).toEqual("fedeinfe");
    expect(body.data.people).toHaveLength(2);
    const columns = Object.fromEntries(
      body.data.issues.map((i: { number: number; column: string }) => [
        i.number,
        i.column,
      ])
    );
    expect(columns).toEqual({
      1: BoardColumn.Todo,
      2: BoardColumn.Waiting,
      3: BoardColumn.Done,
    });
    expect(body.data.issues[0].area).toEqual("fisco");
    expect(body.data.issues[0].type).toEqual("attività");
  });

  it("reads GitHub at most once every 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date();
    vi.setSystemTime(start);
    const user = await buildUser();
    await linkGitHub(user);
    const reads = mockBoard([graphqlIssue(1, {})]);

    await server.post("/api/board.list", user);
    vi.setSystemTime(addSeconds(start, 59));
    await server.post("/api/board.list", user);
    expect(reads.count).toEqual(1);

    vi.setSystemTime(addSeconds(start, 61));
    await server.post("/api/board.list", user);
    expect(reads.count).toEqual(2);
  });

  it("serves the last read as stale when GitHub does not answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date();
    vi.setSystemTime(start);
    const user = await buildUser();
    await linkGitHub(user);
    mockBoard([graphqlIssue(1, {})]);

    const first = await (await server.post("/api/board.list", user)).json();

    msw.use(
      http.post("https://api.github.com/graphql", () =>
        HttpResponse.json({ message: "Server Error" }, { status: 502 })
      )
    );
    vi.setSystemTime(addSeconds(start, 61));
    const res = await server.post("/api/board.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.stale).toBe(true);
    expect(body.data.fetchedAt).toEqual(first.data.fetchedAt);
    expect(body.data.issues).toEqual(first.data.issues);
  });

  it("returns 503 when GitHub never answered", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    msw.use(
      http.post("https://api.github.com/graphql", () =>
        HttpResponse.json({ message: "Server Error" }, { status: 502 })
      )
    );

    const res = await server.post("/api/board.list", user);

    expect(res.status).toEqual(503);
  });
});

describe("#board.move", () => {
  it("returns 403 when the user has not linked GitHub", async () => {
    const user = await buildUser();
    const calls = mockIssue(restIssue());

    const res = await server.post("/api/board.move", user, {
      body: { number: 7, column: BoardColumn.Doing, updatedAt: "x" },
    });

    expect(res.status).toEqual(403);
    expect(calls.authorizations).toHaveLength(0);
  });

  it("adds the stato: label with the user's token", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const before = restIssue();
    const calls = mockIssue(
      before,
      restIssue({
        labels: [{ name: "area:agenti" }, { name: "stato:in-corso" }],
        updated_at: "2026-09-15T10:05:00Z",
      })
    );

    const res = await server.post("/api/board.move", user, {
      body: {
        number: 7,
        column: BoardColumn.Doing,
        updatedAt: before.updated_at,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.result).toEqual("ok");
    expect(body.data.issue.column).toEqual(BoardColumn.Doing);
    expect(calls.patches).toEqual([
      { labels: ["area:agenti", "stato:in-corso"] },
    ]);
    expect(calls.authorizations).toHaveLength(3);
    calls.authorizations.forEach((a) => expect(a).toContain("user-token"));
  });

  it("closes the issue as completed when moved to Fatto", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const before = restIssue({ labels: [{ name: "stato:in-corso" }] });
    const calls = mockIssue(
      before,
      restIssue({ labels: [], state: "closed", closed_at: before.updated_at })
    );

    const res = await server.post("/api/board.move", user, {
      body: {
        number: 7,
        column: BoardColumn.Done,
        updatedAt: before.updated_at,
      },
    });
    const body = await res.json();

    expect(body.data.result).toEqual("ok");
    expect(calls.patches).toEqual([
      { labels: [], state: "closed", state_reason: "completed" },
    ]);
  });

  it("reopens the issue when moved out of Fatto", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const before = restIssue({
      labels: [],
      state: "closed",
      closed_at: "2026-09-14T10:00:00Z",
    });
    const calls = mockIssue(before, restIssue({ labels: [] }));

    const res = await server.post("/api/board.move", user, {
      body: {
        number: 7,
        column: BoardColumn.Todo,
        updatedAt: before.updated_at,
      },
    });
    const body = await res.json();

    expect(body.data.result).toEqual("ok");
    expect(calls.patches).toEqual([
      { state: "open", state_reason: "reopened" },
    ]);
  });

  it("does not write when the issue changed on GitHub since it was read", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const calls = mockIssue(
      restIssue({
        title: "Titolo cambiato",
        updated_at: "2026-09-15T11:00:00Z",
      })
    );

    const res = await server.post("/api/board.move", user, {
      body: {
        number: 7,
        column: BoardColumn.Doing,
        updatedAt: "2026-09-15T10:00:00Z",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.result).toEqual("conflict");
    expect(body.data.issue.title).toEqual("Titolo cambiato");
    expect(calls.patches).toHaveLength(0);
  });

  it("reports a change that GitHub silently discarded", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const before = restIssue();
    const calls = mockIssue(before, before);

    const res = await server.post("/api/board.move", user, {
      body: {
        number: 7,
        column: BoardColumn.Waiting,
        updatedAt: before.updated_at,
      },
    });
    const body = await res.json();

    expect(calls.patches).toHaveLength(1);
    expect(body.data.result).toEqual("rejected");
    expect(body.data.issue.column).toEqual(BoardColumn.Todo);
  });
});

describe("#board.assign", () => {
  it("assigns the issue to a single person with the user's token", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const before = restIssue();
    const calls = mockIssue(
      before,
      restIssue({ assignees: [{ login: "IGOLz", avatar_url: "b" }] })
    );

    const res = await server.post("/api/board.assign", user, {
      body: { number: 7, login: "IGOLz", updatedAt: before.updated_at },
    });
    const body = await res.json();

    expect(body.data.result).toEqual("ok");
    expect(calls.patches).toEqual([{ assignees: ["IGOLz"] }]);
    calls.authorizations.forEach((a) => expect(a).toContain("user-token"));
  });

  it("returns 403 when the user has not linked GitHub", async () => {
    const user = await buildUser();

    const res = await server.post("/api/board.assign", user, {
      body: { number: 7, login: "IGOLz", updatedAt: "x" },
    });

    expect(res.status).toEqual(403);
  });
});

describe("#board.connect", () => {
  it("redirects to GitHub with a state nonce", async () => {
    const user = await buildUser();

    const res = await server.get("/api/board.connect", user, {
      redirect: "manual",
    });

    expect(res.status).toEqual(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toEqual(
      "https://github.com/login/oauth/authorize"
    );
    expect(location.searchParams.get("redirect_uri")).toContain(
      "/api/board.callback"
    );
    expect(res.headers.get("set-cookie")).toContain(
      `boardGitHubOAuthNonce=${location.searchParams.get("state")}`
    );
  });
});

describe("#board.callback", () => {
  it("rejects a state that does not match the nonce cookie", async () => {
    const user = await buildUser();

    const res = await server.get(
      "/api/board.callback?state=attacker&code=123",
      user,
      { redirect: "manual", headers: { cookie: "boardGitHubOAuthNonce=mine" } }
    );

    expect(res.status).toEqual(400);
  });

  it("links the GitHub account of the user", async () => {
    const user = await buildUser();
    msw.use(
      http.post("https://github.com/login/oauth/access_token", () =>
        HttpResponse.json({
          access_token: "new-token",
          refresh_token: "new-refresh",
          expires_in: 28800,
        })
      ),
      http.get("https://api.github.com/user", () =>
        HttpResponse.json({ id: 42, login: "IGOLz" })
      )
    );

    const res = await server.get(
      "/api/board.callback?state=nonce&code=123",
      user,
      { redirect: "manual", headers: { cookie: "boardGitHubOAuthNonce=nonce" } }
    );

    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toContain("/board");
    const auth = await IntegrationAuthentication.findOne({
      where: { userId: user.id, service: IntegrationService.GitHub },
    });
    expect(auth?.token).toEqual("new-token");
    expect(auth?.scopes).toEqual([
      "board",
      "github_user_id:42",
      "github_login:IGOLz",
    ]);
  });

  it("drops the link when the token cannot be refreshed", async () => {
    const user = await buildUser();
    await IntegrationAuthentication.create({
      service: IntegrationService.GitHub,
      userId: user.id,
      teamId: user.teamId,
      token: "expired-token",
      refreshToken: "revoked-refresh",
      expiresAt: subDays(new Date(), 1),
      scopes: ["board", "github_user_id:1", "github_login:fedeinfe"],
    });
    msw.use(
      http.post("https://github.com/login/oauth/access_token", () =>
        HttpResponse.json({ error: "bad_refresh_token" })
      )
    );

    const res = await server.post("/api/board.list", user);

    expect(res.status).toEqual(403);
    expect(
      await IntegrationAuthentication.count({ where: { userId: user.id } })
    ).toEqual(0);
  });
});
