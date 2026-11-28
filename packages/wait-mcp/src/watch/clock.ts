/** Time source used by the polling loops, injected so tests never wait in real time. */
export interface Clock {
  now(): number;
  /** Resolve after `ms`, or as soon as `signal` aborts (dropping the timer). */
  sleep(params: { ms: number; signal?: AbortSignal }): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: ({ ms, signal }: { ms: number; signal?: AbortSignal }) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      function onAbort(): void {
        clearTimeout(timer);
        resolve();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/**
 * Race `work` against a sleep of `ms`, and drop the sleep once the race is
 * decided so no timer outlives it.
 */
export async function raceSleep<T>(params: { clock: Clock; ms: number; work: Promise<T> }): Promise<T | "slept"> {
  const { clock, ms, work } = params;
  const controller = new AbortController();
  try {
    return await Promise.race([work, clock.sleep({ ms, signal: controller.signal }).then(() => "slept" as const)]);
  } finally {
    controller.abort();
  }
}

interface Waiter {
  dueAt: number;
  resolve: () => void;
}

/** Flush already-scheduled promise callbacks so woken loops can register their next sleep. */
function flushPending(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Clock whose time only moves when the test advances it.
 */
export class ManualClock implements Clock {
  private current: number;
  private readonly waiters = new Set<Waiter>();

  constructor(startAt = 0) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  sleep(params: { ms: number; signal?: AbortSignal }): Promise<void> {
    const { ms, signal } = params;
    return new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const waiter: Waiter = { dueAt: this.current + ms, resolve };
      this.waiters.add(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          this.waiters.delete(waiter);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** Number of sleeps currently pending. */
  get pending(): number {
    return this.waiters.size;
  }

  /** Move time forward, waking every sleep that comes due on the way. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;

    let due = this.earliestDue(target);
    while (due) {
      this.current = due.dueAt;
      this.waiters.delete(due);
      due.resolve();
      await flushPending();
      due = this.earliestDue(target);
    }

    this.current = target;
    await flushPending();
  }

  private earliestDue(target: number): Waiter | undefined {
    let earliest: Waiter | undefined;
    for (const waiter of this.waiters) {
      // Only waiters due at or before the target time wake up on this advance
      if (waiter.dueAt > target) continue;
      if (!earliest || waiter.dueAt < earliest.dueAt) {
        earliest = waiter;
      }
    }
    return earliest;
  }
}
