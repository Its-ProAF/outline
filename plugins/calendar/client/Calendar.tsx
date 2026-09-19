import { BackIcon, CalendarIcon, NextIcon } from "outline-icons";
import type * as React from "react";
import { useMemo, useState } from "react";
import styled from "styled-components";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import InputSearch from "~/components/InputSearch";
import Notice from "~/components/Notice";
import Scene from "~/components/Scene";
import useQuery from "~/hooks/useQuery";
import { redirectTo } from "~/utils/urls";
import Facets from "../../board/client/components/Facets";
import type { BoardFilter } from "../../board/client/filters";
import type { BoardData, BoardIssue } from "../../board/shared/types";
import {
  dayLabel,
  isoDate,
  monthOf,
  monthTitle,
  shiftMonth,
  Weekdays,
  weeksOf,
} from "../shared/month";
import DayCell from "./components/DayCell";
import IssueChip from "./components/IssueChip";
import Unscheduled from "./components/Unscheduled";
import {
  byDay,
  chipTone,
  DefaultFilter,
  lateElsewhere,
  visible,
  withoutDeadline,
} from "./filters";
import { useCalendar } from "./useCalendar";

/** Where a dragged issue can be dropped: on a day, or in the tray that clears the day. */
type DropTarget = string | "none";

function Calendar() {
  const { state, schedule } = useCalendar();

  return (
    <Scene icon={<CalendarIcon />} title="Calendario" wide>
      {state.status === "ready" ? (
        <CalendarView board={state.board} onSchedule={schedule} />
      ) : (
        <>
          <Heading>Calendario</Heading>
          {state.status === "unlinked" && <Connect />}
          {state.status === "unavailable" && (
            <Notice>
              GitHub non risponde. Il calendario riprova tra un minuto.
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
        Il calendario mostra le scadenze delle issue di Its-ProAF/ProAF e le
        sposta su GitHub a tuo nome. Per usarlo collega una volta il tuo account
        GitHub: lo stesso collegamento vale anche per la board.
      </Intro>
      <Button onClick={() => redirectTo("/api/board.connect?to=calendario")}>
        Collega GitHub
      </Button>
    </>
  );
}

type ViewProps = {
  board: BoardData;
  onSchedule: (issue: BoardIssue, deadline: string | null) => void;
};

function CalendarView({ board, onSchedule }: ViewProps) {
  const today = isoDate(new Date());
  const [filter, setFilter] = useState<BoardFilter>(DefaultFilter);
  const [month, setMonth] = useState(() => monthOf(today));
  const [dragged, setDragged] = useState<BoardIssue | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const editable = !board.stale;

  const shown = useMemo(
    () => visible(board.issues, filter),
    [board.issues, filter]
  );
  const days = useMemo(() => byDay(shown), [shown]);
  const late = useMemo(
    () => lateElsewhere(shown, today, month),
    [shown, today, month]
  );
  const free = useMemo(() => withoutDeadline(shown), [shown]);
  const weeks = useMemo(() => weeksOf(month), [month]);
  const due = weeks
    .flat()
    .filter((day) => day.inMonth)
    .reduce((total, day) => total + (days.get(day.date)?.length ?? 0), 0);

  const allowDrop = (to: DropTarget) => (event: React.DragEvent) => {
    if (editable && dragged) {
      event.preventDefault();
      setTarget(to);
    }
  };

  const leaveDrop = (event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setTarget(null);
    }
  };

  const drop = (to: DropTarget) => (event: React.DragEvent) => {
    event.preventDefault();
    const issue = dragged;
    setDragged(null);
    setTarget(null);
    if (issue && editable) {
      onSchedule(issue, to === "none" ? null : to);
    }
  };

  const endDrag = () => {
    setDragged(null);
    setTarget(null);
  };

  return (
    <>
      <Header>
        <Heading>Calendario</Heading>
        <Nav>
          <Button
            neutral
            aria-label="Mese precedente"
            icon={<BackIcon />}
            onClick={() => setMonth(shiftMonth(month, -1))}
          />
          <Month aria-live="polite">{monthTitle(month)}</Month>
          <Button
            neutral
            aria-label="Mese successivo"
            icon={<NextIcon />}
            onClick={() => setMonth(shiftMonth(month, 1))}
          />
          <Button neutral onClick={() => setMonth(monthOf(today))}>
            Oggi
          </Button>
        </Nav>
        <Sub>
          {due === 1 ? "1 scadenza" : `${due} scadenze`} ·{" "}
          {editable
            ? "trascina una issue su un giorno per spostarne la scadenza"
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
        <Facets
          board={board}
          filter={filter}
          onChange={setFilter}
          omit={["year"]}
        />
        <div>
          {late.length > 0 && (
            <Late aria-label="In ritardo">
              <LateHeader>
                <strong>In ritardo</strong>
                <Count>{late.length}</Count>
                <Hint>scadute fuori da {monthTitle(month)}</Hint>
              </LateHeader>
              <Chips>
                {late.map((issue) => (
                  <LateItem key={issue.number}>
                    <When>{dayLabel(issue.deadline)}</When>
                    <IssueChip
                      issue={issue}
                      people={board.people}
                      editable={editable}
                      tone={chipTone(issue, today)}
                      onDragStart={() => setDragged(issue)}
                      onDragEnd={endDrag}
                    />
                  </LateItem>
                ))}
              </Chips>
            </Late>
          )}
          <Grid>
            <thead>
              <tr>
                {Weekdays.map((weekday) => (
                  <Weekday key={weekday} scope="col">
                    {weekday}
                  </Weekday>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0].date}>
                  {week.map((day) => (
                    <DayCell
                      key={day.date}
                      day={day}
                      today={today}
                      issues={days.get(day.date) ?? []}
                      people={board.people}
                      editable={editable}
                      dropping={target === day.date}
                      onDragOver={allowDrop(day.date)}
                      onDragLeave={leaveDrop}
                      onDrop={drop(day.date)}
                      onChipDragStart={setDragged}
                      onChipDragEnd={endDrag}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </Grid>
          <Unscheduled
            issues={free}
            people={board.people}
            editable={editable}
            dropping={target === "none"}
            onDragOver={allowDrop("none")}
            onDragLeave={leaveDrop}
            onDrop={drop("none")}
            onChipDragStart={setDragged}
            onChipDragEnd={endDrag}
          />
        </div>
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

const Nav = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Month = styled.span`
  min-width: 9em;
  text-align: center;
  font-weight: 500;
  text-transform: capitalize;
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

const Grid = styled.table`
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 4px;
`;

const Weekday = styled.th`
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
  text-align: left;
  padding: 0 6px 2px;
  color: ${(props) => props.theme.textTertiary};
`;

const Late = styled.section`
  margin-bottom: 14px;
  padding: 8px 10px 10px;
  border: 1px solid ${(props) => props.theme.divider};
  border-left: 3px solid ${(props) => props.theme.danger};
  border-radius: 10px;
`;

const LateHeader = styled.div`
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
  gap: 4px 10px;
`;

const LateItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;

  a {
    max-width: 22em;
  }
`;

const When = styled.span`
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: ${(props) => props.theme.danger};
`;

export default Calendar;
