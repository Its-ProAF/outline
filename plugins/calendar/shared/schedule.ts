import { labelValue } from "../../board/shared/columns";

export const YearLabelPrefix = "anno:";

export type ScheduleChange = { body?: string; labels?: string[] };

// Matches every shape parseDeadline can read, but never past the end of its own line.
const DeadlineLine = /^Scadenza:\s*\d{4}-\d{2}-\d{2}[^\S\n]*$/m;
// The line plus the blank line that separated it from the context below it.
const DeadlineBlock = /^Scadenza:\s*\d{4}-\d{2}-\d{2}[^\S\n]*(?:\r?\n){0,2}/m;

/**
 * Sets, replaces or removes the "Scadenza: AAAA-MM-GG" line of an issue body.
 *
 * @param body the Markdown body of the issue.
 * @param deadline the date as YYYY-MM-DD, or null to take the deadline away.
 * @returns the body carrying the deadline asked for.
 */
export function bodyWithDeadline(
  body: string | null | undefined,
  deadline: string | null
): string {
  const text = body ?? "";

  if (DeadlineLine.test(text)) {
    return deadline
      ? text.replace(DeadlineLine, `Scadenza: ${deadline}`)
      : text.replace(DeadlineBlock, "");
  }
  if (!deadline) {
    return text;
  }

  const line = `Scadenza: ${deadline}`;
  if (!text.trim()) {
    return line;
  }
  // A body written on GitHub keeps CRLF: mixing line endings would show as stray blank lines.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return `${line}${eol}${eol}${text}`;
}

/**
 * Computes the GitHub change that moves the deadline of an issue to a date.
 *
 * @param issue the body, label names and current deadline of the issue.
 * @param deadline the date as YYYY-MM-DD, or null to take the deadline away.
 * @returns the fields to update, or undefined when the deadline is already that.
 */
export function changeForSchedule(
  issue: { body: string | null; labels: string[]; deadline: string | null },
  deadline: string | null
): ScheduleChange | undefined {
  if (issue.deadline === deadline) {
    return;
  }

  const change: ScheduleChange = {
    body: bodyWithDeadline(issue.body, deadline),
  };
  const labels = labelsForYear(issue.labels, deadline);
  if (labels) {
    change.labels = labels;
  }
  return change;
}

/**
 * Realigns the anno: label with the year of a deadline, since the rules want one
 * and only one, and taking a deadline away leaves it alone: the year the work is
 * planned for stays the best thing known about it.
 */
function labelsForYear(labels: string[], deadline: string | null) {
  if (!deadline) {
    return;
  }

  const year = deadline.slice(0, 4);
  const years = labels.filter((l) => l.startsWith(YearLabelPrefix));
  if (years.length === 1 && labelValue(labels, YearLabelPrefix) === year) {
    return;
  }
  return [
    ...labels.filter((l) => !l.startsWith(YearLabelPrefix)),
    `${YearLabelPrefix}${year}`,
  ];
}
