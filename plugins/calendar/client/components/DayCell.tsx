import type * as React from "react";
import styled from "styled-components";
import type { BoardIssue, BoardPerson } from "../../../board/shared/types";
import type { CalendarDay } from "../../shared/month";
import { dayTitle } from "../../shared/month";
import { chipTone } from "../filters";
import IssueChip from "./IssueChip";

type Props = {
  day: CalendarDay;
  today: string;
  issues: BoardIssue[];
  people: BoardPerson[];
  editable: boolean;
  dropping: boolean;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onChipDragStart: (issue: BoardIssue) => void;
  onChipDragEnd: () => void;
};

/** One day of the month grid, and the issues due that day. */
export default function DayCell({
  day,
  today,
  issues,
  people,
  editable,
  dropping,
  onDragOver,
  onDragLeave,
  onDrop,
  onChipDragStart,
  onChipDragEnd,
}: Props) {
  const label =
    issues.length === 1 ? "1 scadenza" : `${issues.length} scadenze`;

  return (
    <Cell
      aria-label={`${dayTitle(day.date)}, ${label}`}
      $outside={!day.inMonth}
      $drop={dropping}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <DayNumber $today={day.date === today}>
        {day.date.slice(8, 10).replace(/^0/, "")}
      </DayNumber>
      <Issues>
        {issues.map((issue) => (
          <IssueChip
            key={issue.number}
            issue={issue}
            people={people}
            editable={editable}
            tone={chipTone(issue, today)}
            onDragStart={() => onChipDragStart(issue)}
            onDragEnd={onChipDragEnd}
          />
        ))}
      </Issues>
    </Cell>
  );
}

const Cell = styled.td<{ $outside: boolean; $drop: boolean }>`
  vertical-align: top;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  padding: 4px;
  height: 104px;
  background: ${(props) =>
    props.$outside ? "transparent" : props.theme.backgroundSecondary};
  outline: ${(props) =>
    props.$drop ? `2px dashed ${props.theme.accent}` : "none"};
  outline-offset: -2px;
`;

const DayNumber = styled.div<{ $today: boolean }>`
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  margin: 0 2px 3px;
  color: ${(props) =>
    props.$today ? props.theme.accentText : props.theme.textTertiary};
  background: ${(props) => (props.$today ? props.theme.accent : "transparent")};
  border-radius: 999px;
  width: fit-content;
  min-width: 18px;
  padding: 0 5px;
  text-align: center;
  font-weight: ${(props) => (props.$today ? 600 : 400)};
`;

const Issues = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
