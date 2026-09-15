import { toError } from "@shared/utils/error";
import { Minute } from "@shared/utils/time";
import Logger from "@server/logging/Logger";
import type { BoardIssue, BoardPerson } from "../shared/types";
import { BoardGitHub } from "./github";

export type BoardSnapshot = {
  issues: BoardIssue[];
  people: BoardPerson[];
  fetchedAt: Date;
};

const FetchTimeoutMs = 15_000;

/** In-memory board read, shared by every user of the process. */
export class BoardCache {
  static readonly ttlMs = Minute.ms;

  private static snapshot?: BoardSnapshot;
  private static failedAt?: number;
  private static pending?: Promise<BoardSnapshot>;

  /**
   * Returns the board, reading GitHub at most once per minute.
   *
   * @returns the last successful read, marked stale when GitHub did not answer.
   * @throws when GitHub does not answer and nothing was ever read.
   */
  static async read(): Promise<BoardSnapshot & { stale: boolean }> {
    const last = this.snapshot;
    const now = Date.now();
    if (last && now - last.fetchedAt.getTime() < this.ttlMs) {
      return { ...last, stale: false };
    }
    // After a failure keep answering from the last read instead of waiting on GitHub at every request.
    if (last && this.failedAt && now - this.failedAt < this.ttlMs) {
      return { ...last, stale: true };
    }

    try {
      return { ...(await this.refresh()), stale: false };
    } catch (err) {
      this.failedAt = Date.now();
      if (!last) {
        throw err;
      }
      Logger.warn(
        "GitHub unavailable, serving the last board read",
        toError(err)
      );
      return { ...last, stale: true };
    }
  }

  /**
   * Replaces an issue after a write, without changing when the board was read.
   *
   * @param issue the issue as just read from GitHub.
   */
  static replaceIssue(issue: BoardIssue) {
    if (!this.snapshot) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      issues: [
        ...this.snapshot.issues.filter((i) => i.number !== issue.number),
        issue,
      ],
    };
  }

  static reset() {
    this.snapshot = undefined;
    this.failedAt = undefined;
    this.pending = undefined;
  }

  private static refresh() {
    this.pending ??= withTimeout(BoardGitHub.fetchBoard(), FetchTimeoutMs)
      .then((data) => {
        this.snapshot = { ...data, fetchedAt: new Date() };
        this.failedAt = undefined;
        return this.snapshot;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("GitHub timeout")), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}
