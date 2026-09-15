import { TodoListIcon } from "outline-icons";
import { useMemo, useState } from "react";
import styled from "styled-components";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import InputSearch from "~/components/InputSearch";
import Notice from "~/components/Notice";
import Scene from "~/components/Scene";
import useQuery from "~/hooks/useQuery";
import { redirectTo } from "~/utils/urls";
import { BoardColumn, BoardColumns } from "../shared/columns";
import type { BoardData, BoardIssue, BoardPerson } from "../shared/types";
import { DoneDays } from "../shared/types";
import BoardCard from "./components/BoardCard";
import Facets from "./components/Facets";
import type { BoardFilter } from "./filters";
import {
  ColumnNames,
  compareIssues,
  deadlineInfo,
  DefaultFilter,
  matches,
} from "./filters";
import { useBoard } from "./useBoard";

function Board() {
  const { state, move, assign } = useBoard();

  return (
    <Scene icon={<TodoListIcon />} title="Board" wide>
      {state.status === "ready" ? (
        <BoardView board={state.board} onMove={move} onAssign={assign} />
      ) : (
        <>
          <Heading>Board</Heading>
          {state.status === "unlinked" && <Connect />}
          {state.status === "unavailable" && (
            <Notice>
              GitHub non risponde. La board riprova tra un minuto.
            </Notice>
          )}
        </>
      )}
    </Scene>
  );
}

function Connect() {
  const error = useQuery().get("error");

  return (
    <>
      {error && (
        <Notice>Collegamento a GitHub non riuscito ({error}). Riprova.</Notice>
      )}
      <Intro>
        La board mostra le issue di Its-ProAF/ProAF e le modifica su GitHub a
        tuo nome. Per usarla collega una volta il tuo account GitHub.
      </Intro>
      <Button onClick={() => redirectTo("/api/board.connect")}>
        Collega GitHub
      </Button>
    </>
  );
}

type ViewProps = {
  board: BoardData;
  onMove: (issue: BoardIssue, column: BoardColumn) => void;
  onAssign: (issue: BoardIssue, person: BoardPerson | null) => void;
};

function BoardView({ board, onMove, onAssign }: ViewProps) {
  const [filter, setFilter] = useState<BoardFilter>(DefaultFilter);
  const [dragged, setDragged] = useState<number | null>(null);
  const [dropColumn, setDropColumn] = useState<BoardColumn | null>(null);
  const editable = !board.stale;

  const visible = useMemo(
    () => board.issues.filter((issue) => matches(issue, filter)),
    [board.issues, filter]
  );
  const open = visible.filter((i) => i.column !== BoardColumn.Done).length;

  const handleDrop = (column: BoardColumn) => {
    const issue = board.issues.find((i) => i.number === dragged);
    setDragged(null);
    setDropColumn(null);
    if (issue && editable) {
      onMove(issue, column);
    }
  };

  return (
    <>
      <Header>
        <Heading>Board</Heading>
        <Sub>
          {open} aperte ·{" "}
          {editable
            ? "trascina una scheda per cambiarne lo stato"
            : "modifiche sospese"}
        </Sub>
        <Search>
          <InputSearch
            value={filter.query}
            placeholder="Cerca nei titoli"
            onChange={(event) =>
              setFilter({ ...filter, query: event.target.value })
            }
          />
        </Search>
      </Header>
      {board.stale && (
        <Notice>
          GitHub non risponde · dati delle{" "}
          {new Date(board.fetchedAt).toLocaleTimeString("it-IT", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Notice>
      )}
      <Layout>
        <Facets board={board} filter={filter} onChange={setFilter} />
        <ColumnsScroll>
          <Columns>
            {BoardColumns.map((column) => {
              const items = visible
                .filter((i) => i.column === column)
                .sort(compareIssues);
              const dueSoon =
                column === BoardColumn.Done
                  ? 0
                  : items.filter(
                      (i) =>
                        i.deadline && deadlineInfo(i.deadline).tone !== "far"
                    ).length;

              return (
                <Column
                  key={column}
                  aria-label={ColumnNames[column]}
                  $drop={dropColumn === column}
                  onDragOver={(event) => {
                    if (editable && dragged !== null) {
                      event.preventDefault();
                      setDropColumn(column);
                    }
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(event.relatedTarget as Node)
                    ) {
                      setDropColumn(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(column);
                  }}
                >
                  <ColumnHeader>
                    <Dot $column={column} />
                    <strong>{ColumnNames[column]}</strong>
                    <Count>{items.length}</Count>
                    {dueSoon > 0 && <DueSoon>{dueSoon} in scadenza</DueSoon>}
                  </ColumnHeader>
                  {column === BoardColumn.Done && (
                    <ColumnNote>
                      Chiuse negli ultimi {DoneDays} giorni
                    </ColumnNote>
                  )}
                  {items.length ? (
                    items.map((issue) => (
                      <BoardCard
                        key={issue.number}
                        issue={issue}
                        people={board.people}
                        editable={editable}
                        showType={!filter.type}
                        onMove={onMove}
                        onAssign={onAssign}
                        onDragStart={() => setDragged(issue.number)}
                        onDragEnd={() => {
                          setDragged(null);
                          setDropColumn(null);
                        }}
                      />
                    ))
                  ) : (
                    <Empty>Niente qui.</Empty>
                  )}
                </Column>
              );
            })}
          </Columns>
        </ColumnsScroll>
      </Layout>
    </>
  );
}

const Intro = styled.p`
  color: ${(props) => props.theme.textSecondary};
  max-width: 36em;
`;

const Header = styled.header`
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;

  h1 {
    margin-bottom: 0;
  }
`;

const Sub = styled.p`
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
`;

const Search = styled.div`
  margin-left: auto;
  width: 15rem;
  max-width: 100%;
`;

const Layout = styled.div`
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 24px;
  margin: 18px 0 64px;
  align-items: start;

  @media (max-width: 1180px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const ColumnsScroll = styled.div`
  overflow-x: auto;
  padding-bottom: 4px;
`;

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(236px, 1fr));
  gap: 12px;
  min-width: min-content;
`;

const Column = styled.section<{ $drop: boolean }>`
  background: ${(props) => props.theme.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 10px;
  padding: 8px;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  outline: ${(props) =>
    props.$drop ? `2px dashed ${props.theme.accent}` : "none"};
  outline-offset: -2px;
`;

const ColumnHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 4px;
`;

const Dot = styled.span<{ $column: BoardColumn }>`
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
  background: ${(props) =>
    ({
      [BoardColumn.Todo]: props.theme.textTertiary,
      [BoardColumn.Doing]: props.theme.accent,
      [BoardColumn.Waiting]: props.theme.warning,
      [BoardColumn.Done]: props.theme.success,
    })[props.$column]};
`;

const Count = styled.span`
  color: ${(props) => props.theme.textTertiary};
  font-variant-numeric: tabular-nums;
`;

const DueSoon = styled.span`
  margin-left: auto;
  font-size: 12px;
  color: ${(props) => props.theme.warning};
`;

const ColumnNote = styled.p`
  margin: -4px 4px 2px;
  font-size: 12px;
  color: ${(props) => props.theme.textTertiary};
`;

const Empty = styled.p`
  color: ${(props) => props.theme.textTertiary};
  padding: 8px 4px;
  margin: 0;
  font-size: 13px;
`;

export default Board;
