export enum BoardColumn {
  Todo = "da-fare",
  Doing = "in-corso",
  Waiting = "in-attesa",
  Done = "fatto",
}

export const BoardColumns = [
  BoardColumn.Todo,
  BoardColumn.Doing,
  BoardColumn.Waiting,
  BoardColumn.Done,
];

export const StatusLabelPrefix = "stato:";

/** Only the intermediate columns are labels: GitHub itself knows open and closed. */
export const StatusLabels: Partial<Record<BoardColumn, string>> = {
  [BoardColumn.Doing]: "stato:in-corso",
  [BoardColumn.Waiting]: "stato:in-attesa",
};

export type IssueState = "open" | "closed";

export type IssueChange = {
  labels?: string[];
  state?: IssueState;
  stateReason?: "completed" | "reopened";
};

/**
 * Returns the board column of an issue from its GitHub state and labels.
 *
 * @param issue the GitHub state and label names of the issue.
 * @returns the column the issue belongs to.
 */
export function columnFor(issue: {
  state: IssueState;
  labels: string[];
}): BoardColumn {
  if (issue.state === "closed") {
    return BoardColumn.Done;
  }
  if (issue.labels.includes(StatusLabels[BoardColumn.Doing]!)) {
    return BoardColumn.Doing;
  }
  if (issue.labels.includes(StatusLabels[BoardColumn.Waiting]!)) {
    return BoardColumn.Waiting;
  }
  return BoardColumn.Todo;
}

/**
 * Computes the GitHub change that moves an issue to a column.
 *
 * @param issue the current GitHub state and label names of the issue.
 * @param to the destination column.
 * @returns the fields to update, or undefined when the issue is already there.
 */
export function changeForMove(
  issue: { state: IssueState; labels: string[] },
  to: BoardColumn
): IssueChange | undefined {
  if (columnFor(issue) === to) {
    return;
  }

  const labels = issue.labels.filter((l) => !l.startsWith(StatusLabelPrefix));
  const label = StatusLabels[to];
  if (label) {
    labels.push(label);
  }

  const change: IssueChange = {};
  if (!sameMembers(labels, issue.labels)) {
    change.labels = labels;
  }
  if (to === BoardColumn.Done && issue.state === "open") {
    change.state = "closed";
    change.stateReason = "completed";
  }
  if (to !== BoardColumn.Done && issue.state === "closed") {
    change.state = "open";
    change.stateReason = "reopened";
  }
  return change;
}

/**
 * Reads the deadline from the "Scadenza: AAAA-MM-GG" line of an issue body.
 *
 * @param body the Markdown body of the issue.
 * @returns the date as YYYY-MM-DD, or null when missing.
 */
export function parseDeadline(body: string | null | undefined): string | null {
  const match = body?.match(/^Scadenza:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  return match ? match[1] : null;
}

/**
 * Returns the value of the first label with a prefix, e.g. "fisco" for "area:".
 *
 * @param labels the label names of the issue.
 * @param prefix the label prefix including the colon.
 * @returns the part after the prefix, or null.
 */
export function labelValue(labels: string[], prefix: string): string | null {
  const label = labels.find((l) => l.startsWith(prefix));
  return label ? label.slice(prefix.length) : null;
}

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((item) => b.includes(item));
}
