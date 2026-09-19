import type * as React from "react";
import styled from "styled-components";
import type { BoardIssue, BoardPerson } from "../../../board/shared/types";
import IssueChip from "./IssueChip";

type Props = {
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

/** The open issues nobody gave a day to, and where a day is taken away again. */
export default function Unscheduled({
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
  return (
    <Tray
      aria-label="Senza scadenza"
      $drop={dropping}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Header>
        <strong>Senza scadenza</strong>
        <Count>{issues.length}</Count>
        {editable && <Hint>trascina qui per togliere la scadenza</Hint>}
      </Header>
      {issues.length ? (
        <Chips>
          {issues.map((issue) => (
            <IssueChip
              key={issue.number}
              issue={issue}
              people={people}
              editable={editable}
              tone="far"
              onDragStart={() => onChipDragStart(issue)}
              onDragEnd={onChipDragEnd}
            />
          ))}
        </Chips>
      ) : (
        <Empty>Ogni issue aperta ha una scadenza.</Empty>
      )}
    </Tray>
  );
}

const Tray = styled.section<{ $drop: boolean }>`
  margin-top: 16px;
  padding: 8px 10px 10px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 10px;
  outline: ${(props) =>
    props.$drop ? `2px dashed ${props.theme.accent}` : "none"};
  outline-offset: -2px;
`;

const Header = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
`;

const Count = styled.span`
  color: ${(props) => props.theme.textTertiary};
  font-variant-numeric: tabular-nums;
`;

const Hint = styled.span`
  margin-left: auto;
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;

  a {
    max-width: 22em;
  }
`;

const Empty = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${(props) => props.theme.textTertiary};
`;
