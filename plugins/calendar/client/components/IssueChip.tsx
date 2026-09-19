import type * as React from "react";
import styled from "styled-components";
import { firstName, TypeNames } from "../../../board/client/filters";
import type { BoardIssue, BoardPerson } from "../../../board/shared/types";
import type { ChipTone } from "../filters";

type Props = {
  issue: BoardIssue;
  people: BoardPerson[];
  editable: boolean;
  tone: ChipTone;
  onDragStart: () => void;
  onDragEnd: () => void;
};

/** One issue on the day it is due, or in the tray of the issues without a day. */
export default function IssueChip({
  issue,
  people,
  editable,
  tone,
  onDragStart,
  onDragEnd,
}: Props) {
  const assignee = issue.assignees[0];
  const who = assignee
    ? firstName(
        people.find((p) => p.login === assignee.login),
        assignee.login
      )
    : "nessuno";

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData("text/plain", String(issue.number));
    onDragStart();
  };

  return (
    <Chip
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={editable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      title={[
        `#${issue.number} ${issue.title}`,
        `Responsabile: ${who}`,
        `Tipo: ${(issue.type && TypeNames[issue.type]) || "senza tipo"}`,
        `Area: ${issue.area ?? "senza area"}`,
        `Macro task: ${issue.milestone ?? "nessuno"}`,
      ].join("\n")}
      $tone={tone}
      $editable={editable}
    >
      <Number>#{issue.number}</Number>
      <Text $done={tone === "done"}>{issue.title}</Text>
    </Chip>
  );
}

const Chip = styled.a<{ $tone: ChipTone; $editable: boolean }>`
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.35;
  text-decoration: none;
  cursor: ${(props) => (props.$editable ? "grab" : "var(--pointer)")};
  background: ${(props) => props.theme.backgroundSecondary};
  border-left: 3px solid
    ${(props) =>
      ({
        done: props.theme.success,
        over: props.theme.danger,
        soon: props.theme.warning,
        far: props.theme.textTertiary,
      })[props.$tone]};
  color: ${(props) =>
    props.$tone === "over" ? props.theme.danger : props.theme.text};

  &:hover {
    background: ${(props) => props.theme.listItemHoverBackground};
  }
`;

const Number = styled.span`
  flex: none;
  color: ${(props) => props.theme.textTertiary};
  font-variant-numeric: tabular-nums;
`;

const Text = styled.span<{ $done: boolean }>`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: ${(props) => (props.$done ? "line-through" : "none")};
  opacity: ${(props) => (props.$done ? 0.7 : 1)};
`;
