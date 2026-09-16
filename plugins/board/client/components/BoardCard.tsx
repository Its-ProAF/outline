import type * as React from "react";
import type { DefaultTheme } from "styled-components";
import styled from "styled-components";
import { BoardColumn, BoardColumns } from "../../shared/columns";
import type { BoardIssue, BoardPerson } from "../../shared/types";
import type { DeadlineTone } from "../filters";
import {
  ColumnNames,
  deadlineInfo,
  firstName,
  shortDate,
  TypeNames,
} from "../filters";

type Props = {
  issue: BoardIssue;
  people: BoardPerson[];
  editable: boolean;
  showType: boolean;
  onMove: (issue: BoardIssue, column: BoardColumn) => void;
  onAssign: (issue: BoardIssue, person: BoardPerson | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

export default function BoardCard({
  issue,
  people,
  editable,
  showType,
  onMove,
  onAssign,
  onDragStart,
  onDragEnd,
}: Props) {
  const assignee = issue.assignees[0];
  const done = issue.column === BoardColumn.Done;
  const deadline = issue.deadline ? deadlineInfo(issue.deadline) : undefined;
  const options =
    assignee && !people.some((p) => p.login === assignee.login)
      ? [...people, assignee]
      : people;

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData("text/plain", String(issue.number));
    onDragStart();
  };

  return (
    <Card
      draggable={editable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      $editable={editable}
    >
      <Title
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        $done={done}
      >
        {issue.title}
      </Title>
      <Meta>
        <span>{issue.milestone ?? "Senza macro task"}</span>
        <span>·</span>
        <span>{issue.area ?? "senza area"}</span>
        {showType && (
          <Type>{(issue.type && TypeNames[issue.type]) || "senza tipo"}</Type>
        )}
      </Meta>
      <Footer>
        <Person $login={assignee?.login}>
          <Initial aria-hidden="true" $login={assignee?.login}>
            {assignee
              ? firstName(
                  people.find((p) => p.login === assignee.login),
                  assignee.login
                )[0]
              : "?"}
          </Initial>
          <Select
            aria-label={`Responsabile di #${issue.number}`}
            value={assignee?.login ?? ""}
            disabled={!editable}
            onChange={(event) =>
              onAssign(
                issue,
                options.find((p) => p.login === event.target.value) ?? null
              )
            }
          >
            <option value="">Nessuno</option>
            {options.map((person) => (
              <option key={person.login} value={person.login}>
                {firstName(person, person.login)}
              </option>
            ))}
          </Select>
        </Person>
        {done && issue.closedAt ? (
          <Muted>chiusa {shortDate(issue.closedAt)}</Muted>
        ) : deadline ? (
          <Deadline $tone={deadline.tone} title="Scadenza">
            {deadline.label}
          </Deadline>
        ) : (
          // Without a deadline the year is the only date the card can show.
          issue.year && <Muted title="Anno">{issue.year}</Muted>
        )}
        <Right>
          <Number>#{issue.number}</Number>
          <StateSelect
            aria-label={`Stato di #${issue.number}`}
            value={issue.column}
            disabled={!editable}
            onChange={(event) =>
              onMove(issue, event.target.value as BoardColumn)
            }
          >
            {BoardColumns.map((column) => (
              <option key={column} value={column}>
                {ColumnNames[column]}
              </option>
            ))}
          </StateSelect>
        </Right>
      </Footer>
    </Card>
  );
}

const Card = styled.article<{ $editable: boolean }>`
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: ${(props) => (props.$editable ? "grab" : "default")};
  box-shadow: 0 1px 2px rgba(17, 19, 25, 0.06);
`;

const Title = styled.a<{ $done: boolean }>`
  font-weight: 500;
  line-height: 1.35;
  color: ${(props) =>
    props.$done ? props.theme.textSecondary : props.theme.text};
  text-decoration: ${(props) => (props.$done ? "line-through" : "none")};

  &:hover {
    text-decoration: underline;
  }
`;

const Meta = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const Type = styled.span`
  font-size: 11px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 999px;
  padding: 0 6px;
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  flex-wrap: wrap;
`;

/** Gives each person a stable color so their cards are recognizable at a glance. */
const personColor = (props: { $login?: string; theme: DefaultTheme }) => {
  if (!props.$login) {
    return props.theme.textTertiary;
  }
  const palette = [
    props.theme.brand.purple,
    props.theme.brand.marine,
    props.theme.brand.green,
    props.theme.brand.red,
  ];
  let hash = 0;
  for (let i = 0; i < props.$login.length; i++) {
    hash += props.$login.charCodeAt(i);
  }
  return palette[hash % palette.length];
};

const Person = styled.span<{ $login?: string }>`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding-left: 3px;
  color: ${personColor};
  background: ${(props) => props.theme.backgroundSecondary};
`;

const Initial = styled.span<{ $login?: string }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: ${(props) => props.theme.background};
  background: ${personColor};
`;

const Select = styled.select`
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 500;
  padding: 1px 9px 1px 4px;
  cursor: var(--pointer);
`;

const Deadline = styled.span<{ $tone: DeadlineTone }>`
  border-radius: 4px;
  padding: 0 6px;
  font-weight: 500;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: ${(props) =>
    props.$tone === "over"
      ? props.theme.danger
      : props.$tone === "soon"
        ? props.theme.warning
        : props.theme.textSecondary};
  background: ${(props) =>
    props.$tone === "far" ? "transparent" : props.theme.backgroundSecondary};
`;

const Muted = styled.span`
  color: ${(props) => props.theme.textSecondary};
`;

const Right = styled.span`
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
`;

const Number = styled.span`
  font-family: ${(props) => props.theme.fontFamilyMono};
  color: ${(props) => props.theme.textTertiary};
  font-variant-numeric: tabular-nums;
`;

const StateSelect = styled.select`
  border: 1px solid ${(props) => props.theme.divider};
  background: transparent;
  border-radius: 5px;
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  padding: 0 2px;
  max-width: 6.5rem;
  cursor: var(--pointer);
`;
