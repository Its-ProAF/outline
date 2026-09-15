import type { BoardColumn, IssueState } from "./columns";

export const BoardRepository = { owner: "Its-ProAF", name: "ProAF" };

/** Closed issues stay in the Fatto column for this many days. */
export const DoneDays = 14;

export type BoardPerson = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

export type BoardIssue = {
  number: number;
  title: string;
  url: string;
  state: IssueState;
  column: BoardColumn;
  labels: string[];
  area: string | null;
  type: string | null;
  assignees: BoardPerson[];
  milestone: string | null;
  deadline: string | null;
  updatedAt: string;
  closedAt: string | null;
};

export type BoardData = {
  repository: string;
  viewer: { login: string | null };
  issues: BoardIssue[];
  people: BoardPerson[];
  fetchedAt: string;
  stale: boolean;
};

export type BoardWriteResult = {
  /** "conflict": changed on GitHub since it was read; "rejected": GitHub ignored the change. */
  result: "ok" | "conflict" | "rejected";
  issue: BoardIssue;
};
