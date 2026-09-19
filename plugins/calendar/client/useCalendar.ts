import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { client } from "~/utils/ApiClient";
import { AuthorizationError } from "~/utils/errors";
import type {
  BoardData,
  BoardIssue,
  BoardWriteResult,
} from "../../board/shared/types";
import { dayLabel } from "../shared/month";

const RefreshMs = 60_000;

export type CalendarState =
  | { status: "loading" }
  | { status: "unlinked" }
  | { status: "unavailable" }
  | { status: "ready"; board: BoardData };

/** Loads the issues, keeps them fresh while visible and writes deadlines to GitHub. */
export function useCalendar() {
  const [state, setState] = useState<CalendarState>({ status: "loading" });
  const lastWriteAt = useRef(0);

  const load = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const res = await client.post<{ data: BoardData }>("/calendar.list");
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

  const schedule = useCallback(
    async (issue: BoardIssue, deadline: string | null, undoable = true) => {
      if (issue.deadline === deadline) {
        return;
      }
      const previous = issue.deadline;
      putIssue({ ...issue, deadline });

      let result: BoardWriteResult;
      try {
        const res = await client.post<{ data: BoardWriteResult }>(
          "/calendar.schedule",
          { number: issue.number, updatedAt: issue.updatedAt, deadline }
        );
        result = res.data;
      } catch (err) {
        putIssue(issue);
        if (err instanceof AuthorizationError) {
          setState({ status: "unlinked" });
          return;
        }
        toast.error("GitHub non risponde, scadenza non salvata");
        void load();
        return;
      }

      lastWriteAt.current = Date.now();
      putIssue(result.issue);
      if (result.result === "conflict") {
        toast.error("Issue cambiata su GitHub, ricontrolla");
        return;
      }
      if (result.result === "rejected") {
        toast.error(
          "GitHub non ha applicato la modifica: controlla i tuoi permessi sul repository"
        );
        return;
      }

      toast.success(
        deadline
          ? `#${issue.number} scade il ${dayLabel(deadline)}`
          : `#${issue.number} senza scadenza`,
        undoable
          ? {
              action: {
                label: "Annulla",
                onClick: () => void schedule(result.issue, previous, false),
              },
            }
          : undefined
      );
    },
    [load, putIssue]
  );

  return { state, schedule };
}
