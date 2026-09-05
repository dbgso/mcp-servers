/** Time source used by the polling loops, injected so tests never wait in real time. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

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

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.add({ dueAt: this.current + ms, resolve });
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
