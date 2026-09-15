import { BoardColumn } from "../shared/columns";
import type { BoardIssue, BoardPerson } from "../shared/types";
import { DoneDays } from "../shared/types";

const DayMs = 86_400_000;

/** Filter value that selects issues without an assignee or macro task. */
export const NoValue = "__none";

export type BoardFilter = {
  assignee: string;
  type: string;
  milestone: string;
  area: string;
  query: string;
};

export type FacetKey = Exclude<keyof BoardFilter, "query">;

export const DefaultFilter: BoardFilter = {
  assignee: "",
  type: "attività",
  milestone: "",
  area: "",
  query: "",
};

export const ColumnNames: Record<BoardColumn, string> = {
  [BoardColumn.Todo]: "Da fare",
  [BoardColumn.Doing]: "In corso",
  [BoardColumn.Waiting]: "In attesa",
  [BoardColumn.Done]: "Fatto",
};

export const TypeNames: Record<string, string> = {
  attività: "Attività",
  "da-decidere": "Da decidere",
  sviluppo: "Sviluppo",
};

export const AreaOrder = [
  "società",
  "fisco",
  "prodotti",
  "infrastruttura",
  "agenti",
];

export function matches(issue: BoardIssue, filter: BoardFilter) {
  if (
    issue.column === BoardColumn.Done &&
    issue.closedAt &&
    Date.now() - Date.parse(issue.closedAt) > DoneDays * DayMs
  ) {
    return false;
  }
  const logins = issue.assignees.map((a) => a.login);
  if (
    filter.assignee &&
    (filter.assignee === NoValue
      ? logins.length > 0
      : !logins.includes(filter.assignee))
  ) {
    return false;
  }
  if (filter.type && issue.type !== filter.type) {
    return false;
  }
  if (
    filter.milestone &&
    (filter.milestone === NoValue
      ? issue.milestone !== null
      : issue.milestone !== filter.milestone)
  ) {
    return false;
  }
  if (filter.area && issue.area !== filter.area) {
    return false;
  }
  if (
    filter.query &&
    !issue.title.toLowerCase().includes(filter.query.toLowerCase())
  ) {
    return false;
  }
  return true;
}

export function countFor(
  issues: BoardIssue[],
  filter: BoardFilter,
  key: FacetKey,
  value: string
) {
  const facetFilter = { ...filter, [key]: value };
  return issues.filter((issue) => matches(issue, facetFilter)).length;
}

/** Open issues by nearest deadline then number, closed issues by most recent closing. */
export function compareIssues(a: BoardIssue, b: BoardIssue) {
  if (a.column === BoardColumn.Done) {
    return (b.closedAt ?? "").localeCompare(a.closedAt ?? "");
  }
  const da = a.deadline ?? "9999";
  const db = b.deadline ?? "9999";
  return da === db ? a.number - b.number : da.localeCompare(db);
}

export type DeadlineTone = "over" | "soon" | "far";

export function deadlineInfo(deadline: string): {
  label: string;
  tone: DeadlineTone;
} {
  const [year, month, day] = deadline.split("-");
  const days = Math.floor(
    (new Date(`${deadline}T23:59:00`).getTime() - Date.now()) / DayMs
  );
  return {
    label: `${day}-${month}-${year}`,
    tone: days < 0 ? "over" : days <= 14 ? "soon" : "far",
  };
}

export function shortDate(iso: string) {
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
}

export function firstName(person: BoardPerson | undefined, login: string) {
  return person?.name?.split(" ")[0] || login;
}
