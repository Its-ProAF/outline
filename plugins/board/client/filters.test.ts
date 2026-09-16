import { BoardColumn } from "../shared/columns";
import type { BoardIssue } from "../shared/types";
import { DefaultFilter, matches } from "./filters";

function issue(overrides: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number: 7,
    title: "Issue di prova",
    url: "https://github.com/Its-ProAF/ProAF/issues/7",
    state: "open",
    column: BoardColumn.Todo,
    labels: ["area:fisco", "tipo:attività"],
    area: "fisco",
    type: "attività",
    year: String(new Date().getFullYear()),
    assignees: [],
    milestone: null,
    deadline: null,
    updatedAt: "2026-09-15T10:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

describe("matches, filtro per anno", () => {
  it("di base mostra solo l'anno in corso", () => {
    expect(matches(issue(), DefaultFilter)).toBe(true);
    expect(matches(issue({ year: "2027" }), DefaultFilter)).toBe(false);
  });

  it("mostra l'anno scelto", () => {
    const filter = { ...DefaultFilter, year: "2027" };
    expect(matches(issue({ year: "2027" }), filter)).toBe(true);
    expect(matches(issue({ year: "2028" }), filter)).toBe(false);
  });

  it("non nasconde le issue senza anno", () => {
    expect(matches(issue({ year: null }), DefaultFilter)).toBe(true);
    expect(
      matches(issue({ year: null }), { ...DefaultFilter, year: "2028" })
    ).toBe(true);
  });

  it("mostra tutti gli anni senza filtro", () => {
    const filter = { ...DefaultFilter, year: "" };
    expect(matches(issue({ year: "2028" }), filter)).toBe(true);
  });
});
