import type { BoardFilter } from "../../board/client/filters";
import { matches } from "../../board/client/filters";
import { BoardColumn } from "../../board/shared/columns";
import type { BoardIssue } from "../../board/shared/types";
import { monthOf } from "../shared/month";

const DayMs = 86_400_000;

/** How near a deadline is, which decides the colour of a chip. */
export type ChipTone = "done" | "over" | "soon" | "far";

/** An issue that does have a deadline. */
export type DatedIssue = BoardIssue & { deadline: string };

/**
 * The calendar places an issue by its deadline, so the anno: label has nothing
 * left to filter and the type is not narrowed: a deadline counts whatever it is.
 */
export const DefaultFilter: BoardFilter = {
  assignee: "",
  type: "",
  milestone: "",
  area: "",
  year: "",
  query: "",
};

/**
 * Counts whole days between two days, in neither timezone in particular.
 *
 * @param date the day as YYYY-MM-DD.
 * @param from the day to count from, as YYYY-MM-DD.
 * @returns the days, negative when the date is already past.
 */
export function daysBetween(date: string, from: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DayMs
  );
}

/**
 * Returns how a chip should read, from closed to still far away.
 *
 * @param issue the issue the chip stands for.
 * @param today the current day as YYYY-MM-DD.
 * @returns the tone of the chip.
 */
export function chipTone(issue: BoardIssue, today: string): ChipTone {
  if (issue.column === BoardColumn.Done) {
    return "done";
  }
  if (!issue.deadline) {
    return "far";
  }
  const days = daysBetween(issue.deadline, today);
  return days < 0 ? "over" : days <= 14 ? "soon" : "far";
}

/**
 * Keeps the issues the filters let through.
 *
 * @param issues every issue read from GitHub.
 * @param filter the filters chosen in the sidebar.
 * @returns the issues to show.
 */
export function visible(
  issues: BoardIssue[],
  filter: BoardFilter
): BoardIssue[] {
  return issues.filter((issue) => matches(issue, filter));
}

/**
 * Groups the issues that have a deadline by the day they are due.
 *
 * @param issues the issues to place.
 * @returns the issues of each day, in the order they are shown.
 */
export function byDay(issues: BoardIssue[]): Map<string, BoardIssue[]> {
  const days = new Map<string, BoardIssue[]>();
  for (const issue of issues) {
    if (!issue.deadline) {
      continue;
    }
    const day = days.get(issue.deadline);
    if (day) {
      day.push(issue);
    } else {
      days.set(issue.deadline, [issue]);
    }
  }
  for (const day of days.values()) {
    day.sort(compareInDay);
  }
  return days;
}

/**
 * Returns the open issues whose deadline is past and falls outside the month on
 * screen, the only late work the grid cannot show.
 *
 * @param issues the issues to look through.
 * @param today the current day as YYYY-MM-DD.
 * @param month the month on screen, as YYYY-MM.
 * @returns the late issues, the most late first.
 */
export function lateElsewhere(
  issues: BoardIssue[],
  today: string,
  month: string
): DatedIssue[] {
  return issues
    .filter(
      (issue): issue is DatedIssue =>
        issue.deadline !== null &&
        issue.deadline < today &&
        monthOf(issue.deadline) !== month &&
        issue.column !== BoardColumn.Done
    )
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

/**
 * Returns the open issues nobody gave a day to yet.
 *
 * @param issues the issues to look through.
 * @returns the issues without a deadline, by number.
 */
export function withoutDeadline(issues: BoardIssue[]): BoardIssue[] {
  return issues
    .filter((issue) => !issue.deadline && issue.column !== BoardColumn.Done)
    .sort((a, b) => a.number - b.number);
}

/** Work still to do comes before work already closed, then the oldest issue first. */
function compareInDay(a: BoardIssue, b: BoardIssue) {
  const done =
    Number(a.column === BoardColumn.Done) -
    Number(b.column === BoardColumn.Done);
  return done === 0 ? a.number - b.number : done;
}
