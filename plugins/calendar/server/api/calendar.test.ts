import { addHours } from "date-fns";
import { http, HttpResponse } from "msw";
import { IntegrationService } from "@shared/types";
import type { User } from "@server/models";
import { IntegrationAuthentication } from "@server/models";
import { buildUser } from "@server/test/factories";
import { server as msw } from "@server/test/msw";
import { getTestServer } from "@server/test/support";
import { BoardCache } from "plugins/board/server/cache";
import { BoardGitHub } from "plugins/board/server/github";

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
    body: "Scadenza: 2026-09-30\n\nContesto.",
    labels: [{ name: "area:fisco" }, { name: "anno:2026" }],
    assignees: [],
    milestone: null,
    ...overrides,
  };
}

/** Serves an issue that reads as `before` until it is patched, then as `after`. */
function mockIssue(before: RestIssue, after: RestIssue = before) {
  const calls = { patches: [] as Record<string, unknown>[] };
  let current = before;
  msw.use(
    http.get(IssueUrl, () => HttpResponse.json(current)),
    http.patch(IssueUrl, async ({ request }) => {
      calls.patches.push((await request.json()) as Record<string, unknown>);
      current = after;
      return HttpResponse.json(after);
    })
  );
  return calls;
}

/** Serves the GraphQL queries the shared snapshot is built from. */
function mockIssues(nodes: Record<string, unknown>[]) {
  msw.use(
    http.post("https://api.github.com/graphql", async ({ request }) => {
      const { query, variables } = (await request.json()) as {
        query: string;
        variables: { states?: string[] };
      };
      if (query.includes("BoardPeople")) {
        return HttpResponse.json({
          data: {
            repository: {
              assignableUsers: {
                nodes: [
                  { login: "fedeinfe", name: "Federico", avatarUrl: "a" },
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
              nodes: variables.states?.[0] === "CLOSED" ? [] : nodes,
            },
          },
        },
      });
    })
  );
}

function graphqlIssue(number: number, body: string, labels: string[] = []) {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/Its-ProAF/ProAF/issues/${number}`,
    state: "OPEN",
    updatedAt: "2026-09-15T10:00:00Z",
    closedAt: null,
    body,
    assignees: { nodes: [] },
    milestone: null,
    labels: { nodes: labels.map((name) => ({ name })) },
  };
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

describe("#calendar.list", () => {
  it("returns 403 when the user has not linked GitHub", async () => {
    const user = await buildUser();

    const res = await server.post("/api/calendar.list", user);

    expect(res.status).toEqual(403);
  });

  it("returns the deadline read from the body of each issue", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    mockIssues([
      graphqlIssue(1, "Scadenza: 2026-10-15\n\nContesto."),
      graphqlIssue(2, "Nessuna scadenza qui."),
    ]);

    const res = await server.post("/api/calendar.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.viewer.login).toEqual("fedeinfe");
    const deadlines = Object.fromEntries(
      body.data.issues.map((i: { number: number; deadline: string | null }) => [
        i.number,
        i.deadline,
      ])
    );
    expect(deadlines).toEqual({ 1: "2026-10-15", 2: null });
  });
});

describe("#calendar.schedule", () => {
  it("returns 403 when the user has not linked GitHub", async () => {
    const user = await buildUser();

    const res = await server.post("/api/calendar.schedule", user, {
      body: { number: 7, deadline: "2026-10-15", updatedAt: "x" },
    });

    expect(res.status).toEqual(403);
  });

  it("refuses a day that does not exist", async () => {
    const user = await buildUser();
    await linkGitHub(user);

    const res = await server.post("/api/calendar.schedule", user, {
      body: { number: 7, deadline: "2026-02-31", updatedAt: "x" },
    });

    expect(res.status).toEqual(400);
  });

  it("refuses a date that is not a day", async () => {
    const user = await buildUser();
    await linkGitHub(user);

    const res = await server.post("/api/calendar.schedule", user, {
      body: { number: 7, deadline: "domani", updatedAt: "x" },
    });

    expect(res.status).toEqual(400);
  });

  it("writes the new deadline in the body as the user", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const after = restIssue({
      body: "Scadenza: 2026-10-15\n\nContesto.",
      updated_at: "2026-09-15T11:00:00Z",
    });
    const calls = mockIssue(restIssue(), after);

    const res = await server.post("/api/calendar.schedule", user, {
      body: {
        number: 7,
        deadline: "2026-10-15",
        updatedAt: "2026-09-15T10:00:00Z",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.result).toEqual("ok");
    expect(body.data.issue.deadline).toEqual("2026-10-15");
    expect(calls.patches).toEqual([
      { body: "Scadenza: 2026-10-15\n\nContesto." },
    ]);
  });

  it("moves the anno: label with the deadline", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const after = restIssue({
      body: "Scadenza: 2027-04-30\n\nContesto.",
      labels: [{ name: "area:fisco" }, { name: "anno:2027" }],
      updated_at: "2026-09-15T11:00:00Z",
    });
    const calls = mockIssue(restIssue(), after);

    const res = await server.post("/api/calendar.schedule", user, {
      body: {
        number: 7,
        deadline: "2027-04-30",
        updatedAt: "2026-09-15T10:00:00Z",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.issue.year).toEqual("2027");
    expect(calls.patches).toEqual([
      {
        body: "Scadenza: 2027-04-30\n\nContesto.",
        labels: ["area:fisco", "anno:2027"],
      },
    ]);
  });

  it("takes the deadline away and leaves the year alone", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const after = restIssue({
      body: "Contesto.",
      updated_at: "2026-09-15T11:00:00Z",
    });
    const calls = mockIssue(restIssue(), after);

    const res = await server.post("/api/calendar.schedule", user, {
      body: { number: 7, deadline: null, updatedAt: "2026-09-15T10:00:00Z" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.issue.deadline).toBeNull();
    expect(body.data.issue.year).toEqual("2026");
    expect(calls.patches).toEqual([{ body: "Contesto." }]);
  });

  it("does not write when the issue already has that deadline", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const calls = mockIssue(restIssue());

    const res = await server.post("/api/calendar.schedule", user, {
      body: {
        number: 7,
        deadline: "2026-09-30",
        updatedAt: "2026-09-15T10:00:00Z",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.result).toEqual("ok");
    expect(calls.patches).toEqual([]);
  });

  it("refuses to write over a change made on GitHub", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    const calls = mockIssue(restIssue({ updated_at: "2026-09-16T08:00:00Z" }));

    const res = await server.post("/api/calendar.schedule", user, {
      body: {
        number: 7,
        deadline: "2026-10-15",
        updatedAt: "2026-09-15T10:00:00Z",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.result).toEqual("conflict");
    expect(body.data.issue.deadline).toEqual("2026-09-30");
    expect(calls.patches).toEqual([]);
  });

  it("reports the modification GitHub silently dropped", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    // Without push access GitHub answers 200 and keeps the body as it was.
    const calls = mockIssue(restIssue(), restIssue());

    const res = await server.post("/api/calendar.schedule", user, {
      body: {
        number: 7,
        deadline: "2026-10-15",
        updatedAt: "2026-09-15T10:00:00Z",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.result).toEqual("rejected");
    expect(calls.patches).toHaveLength(1);
  });

  it("says the issue is gone when GitHub cannot find it", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    msw.use(
      http.get(IssueUrl, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 })
      )
    );

    const res = await server.post("/api/calendar.schedule", user, {
      body: { number: 7, deadline: "2026-10-15", updatedAt: "x" },
    });

    expect(res.status).toEqual(404);
  });

  it("drops the link when GitHub refuses the token", async () => {
    const user = await buildUser();
    await linkGitHub(user);
    msw.use(
      http.get(IssueUrl, () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 })
      )
    );

    const res = await server.post("/api/calendar.schedule", user, {
      body: { number: 7, deadline: "2026-10-15", updatedAt: "x" },
    });

    expect(res.status).toEqual(403);
    expect(
      await IntegrationAuthentication.count({ where: { userId: user.id } })
    ).toEqual(0);
  });
});
