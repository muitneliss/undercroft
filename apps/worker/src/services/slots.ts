/**
 * How many runs of one kind this worker does at once, and the queue the rest wait in (ADR 0088).
 *
 * Every verb used to start its run the moment it was accepted: a Kestra tick answers 202 per due
 * pair, so a thousand tenants due together were a thousand ingests -- and then a thousand dbt
 * builds, each a Python process and ~5 tenant connections -- in one 3 GB process. A run now takes
 * a turn first. It has already been opened in the ledger when it waits, which is deliberate: the
 * `run_one_running` index keeps the tenant's place, a second trigger for the same pair is still
 * refused, and the caller has the run's id at once. The row reads `running` while it waits; a
 * fourth status was rejected in ADR 0051.
 *
 * A turn is per process. With several workers the total is several times this, and the cap that
 * holds regardless is the pooler's on Postgres (`MAX_DB_CONNECTIONS`).
 *
 * A waiter leaves the queue without doing anything when the process is told to stop, or when it
 * was given a budget and the budget runs out; either way it rejects with an error whose message is
 * what the ledger records, so the run closes saying why nothing happened.
 */

/**
 * Why a run left the queue without starting: the worker was told to stop, or its caller could
 * not wait any longer (`busy`). The message is what the ledger records for the run.
 */
const WHY_NOT_STARTED = {
  stopping:
    "the worker was told to stop while this run waited for its turn; it did nothing, and the next scheduled run will do it",
  busy: "the worker is busy with other runs of this kind and nothing ran; try again in a minute",
} as const;

/** A run that left the queue without starting. Nothing of it had run. */
export class NotStarted extends Error {
  readonly why: keyof typeof WHY_NOT_STARTED;

  constructor(why: keyof typeof WHY_NOT_STARTED) {
    super(WHY_NOT_STARTED[why]);
    this.name = "NotStarted";
    this.why = why;
  }
}

export interface TurnOptions {
  /** Leave the queue, doing nothing, when this aborts. Absent: nothing will ask it to. */
  readonly stop?: AbortSignal;
  /** Leave the queue, doing nothing, after this long. Absent: wait as long as it takes. */
  readonly waitMs?: number;
  /** Told how many are waiting, itself included, when the run has to queue. */
  readonly onWait?: (waiting: number) => void;
}

export interface Slots {
  /** Run `work` once a turn is free, and hold the turn until it settles. */
  readonly run: <T>(work: () => Promise<T>, options?: TurnOptions) => Promise<T>;
}

/** Every kind of run that takes a turn. Absent from `RunDeps.turns`: unlimited, as before. */
export interface RunTurns {
  readonly ingest?: Slots;
  readonly build?: Slots;
  /** Builds a person at the model editor is waiting on, apart from the scheduled ones. */
  readonly editorBuild?: Slots;
  readonly extract?: Slots;
  readonly semantic?: Slots;
}

/** No limit: `work` runs at once. What a run gets when no limit was configured for its kind. */
export const UNLIMITED: Slots = {
  run: (work, options) =>
    options?.stop?.aborted === true ? Promise.reject(new NotStarted("stopping")) : work(),
};

/** The turns for one kind of run, or no limit when this process configured none for it. */
export function turnsFor(turns: RunTurns | undefined, kind: keyof RunTurns): Slots {
  return turns?.[kind] ?? UNLIMITED;
}

interface Waiter {
  readonly go: () => void;
}

export function createSlots(limit: number): Slots {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`a run limit must be a whole number of at least 1, not ${String(limit)}`);
  }
  let running = 0;
  const waiting: Waiter[] = [];

  function release(): void {
    running -= 1;
    const next = waiting.shift();
    if (next !== undefined) {
      running += 1;
      next.go();
    }
  }

  function turn(options: TurnOptions): Promise<void> {
    if (options.stop?.aborted === true) {
      return Promise.reject(new NotStarted("stopping"));
    }
    if (running < limit) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      function forget(): void {
        options.stop?.removeEventListener("abort", onStop);
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
      const waiter: Waiter = {
        go: (): void => {
          forget();
          resolve();
        },
      };
      function leave(why: NotStarted["why"]): void {
        const at = waiting.indexOf(waiter);
        if (at !== -1) {
          waiting.splice(at, 1);
        }
        forget();
        reject(new NotStarted(why));
      }
      function onStop(): void {
        leave("stopping");
      }
      if (options.waitMs !== undefined) {
        timer = setTimeout(() => leave("busy"), options.waitMs);
      }
      options.stop?.addEventListener("abort", onStop, { once: true });
      waiting.push(waiter);
      options.onWait?.(waiting.length);
    });
  }

  return {
    async run<T>(work: () => Promise<T>, options: TurnOptions = {}): Promise<T> {
      await turn(options);
      try {
        return await work();
      } finally {
        release();
      }
    },
  };
}
