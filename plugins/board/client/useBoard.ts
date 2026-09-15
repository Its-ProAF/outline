import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { client } from "~/utils/ApiClient";
import { AuthorizationError } from "~/utils/errors";
import type { BoardColumn } from "../shared/columns";
import type {
  BoardData,
  BoardIssue,
  BoardPerson,
  BoardWriteResult,
} from "../shared/types";
import { ColumnNames, firstName } from "./filters";

const RefreshMs = 60_000;

export type BoardState =
  | { status: "loading" }
  | { status: "unlinked" }
  | { status: "unavailable" }
  | { status: "ready"; board: BoardData };

/** Loads the board, keeps it fresh while visible and writes changes to GitHub. */
export function useBoard() {
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const lastWriteAt = useRef(0);

  const load = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const res = await client.post<{ data: BoardData }>("/board.list");
      // A read started before a write finished would bring back the issue as it was.
      if (startedAt < lastWriteAt.current) {
        return;
      }
      setState({ status: "ready", board: res.data });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        setState({ status: "unlinked" });
        return;
      }
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", board: { ...prev.board, stale: true } }
          : { status: "unavailable" }
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    const timer = setInterval(refreshIfVisible, RefreshMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  const putIssue = useCallback((issue: BoardIssue) => {
    setState((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            board: {
              ...prev.board,
              issues: [
                ...prev.board.issues.filter((i) => i.number !== issue.number),
                issue,
              ],
            },
          }
        : prev
    );
  }, []);

  const write = useCallback(
    async (
      path: "/board.move" | "/board.assign",
      issue: BoardIssue,
      optimistic: BoardIssue,
      body: { column: BoardColumn } | { login: string | null }
    ): Promise<BoardIssue | undefined> => {
      putIssue(optimistic);
      try {
        const res = await client.post<{ data: BoardWriteResult }>(path, {
          number: issue.number,
          updatedAt: issue.updatedAt,
          ...body,
        });
        lastWriteAt.current = Date.now();
        putIssue(res.data.issue);
        if (res.data.result === "conflict") {
          toast.error("Issue cambiata su GitHub, ricontrolla");
          return;
        }
        if (res.data.result === "rejected") {
          toast.error(
            "GitHub non ha applicato la modifica: controlla i tuoi permessi sul repository"
          );
          return;
        }
        return res.data.issue;
      } catch (err) {
        putIssue(issue);
        if (err instanceof AuthorizationError) {
          setState({ status: "unlinked" });
          return;
        }
        toast.error("GitHub non risponde, modifica non salvata");
        void load();
        return;
      }
    },
    [load, putIssue]
  );

  const move = useCallback(
    async (issue: BoardIssue, column: BoardColumn, undoable = true) => {
      if (issue.column === column) {
        return;
      }
      const updated = await write(
        "/board.move",
        issue,
        { ...issue, column },
        { column }
      );
      if (updated) {
        toast.success(
          `#${issue.number} spostata in ${ColumnNames[column]}`,
          undoable
            ? {
                action: {
                  label: "Annulla",
                  onClick: () => void move(updated, issue.column, false),
                },
              }
            : undefined
        );
      }
    },
    [write]
  );

  const assign = useCallback(
    async (issue: BoardIssue, person: BoardPerson | null, undoable = true) => {
      const previous = issue.assignees[0] ?? null;
      if (previous?.login === person?.login && issue.assignees.length <= 1) {
        return;
      }
      const updated = await write(
        "/board.assign",
        issue,
        { ...issue, assignees: person ? [person] : [] },
        { login: person?.login ?? null }
      );
      if (updated) {
        toast.success(
          person
            ? `#${issue.number} assegnata a ${firstName(person, person.login)}`
            : `#${issue.number} senza responsabile`,
          undoable
            ? {
                action: {
                  label: "Annulla",
                  onClick: () => void assign(updated, previous, false),
                },
              }
            : undefined
        );
      }
    },
    [write]
  );

  return { state, move, assign };
}
