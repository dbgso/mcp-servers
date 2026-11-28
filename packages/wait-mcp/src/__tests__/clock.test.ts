import { describe, expect, it, vi } from "vitest";
import { ManualClock, raceSleep, systemClock } from "../watch/clock.js";
import { WatchManager } from "../watch/manager.js";
import { createFakeDeps, sequence, tick } from "./helpers.js";

const DOWN = { status: 503, body: "down" };
const UP = { status: 200, body: "ok" };

function healthManager(responses: { status: number; body: string }[]) {
  const clock = new ManualClock();
  const manager = new WatchManager({ clock, deps: createFakeDeps({ httpRequest: sequence(responses) }) });
  const spec = { source: "http", config: { url: "https://example.com/", expect: { status: 200 } }, intervalMs: 10_000 };
  return { clock, manager, spec };
}

describe("timers", () => {
  it("keeps one sleep per waiting watch, however many polls ran", async () => {
    const { clock, manager, spec } = healthManager([DOWN]);
    manager.create(spec);
    await tick();
    for (let poll = 0; poll < 5; poll += 1) {
      await clock.advance(10_000);
    }
    expect(clock.pending).toBe(1);
  });

  it("leaves no sleep behind once a watch is cancelled or satisfied", async () => {
    const { clock, manager, spec } = healthManager([DOWN, UP]);
    const cancelled = manager.create(spec);
    await tick();
    manager.cancel(cancelled.id);
    await tick();
    expect(clock.pending).toBe(0);

    const satisfied = manager.create(spec);
    await tick();
    await clock.advance(10_000);
    expect(satisfied.status).toBe("satisfied");
    expect(clock.pending).toBe(0);
  });

  it("drops the block-limit sleep when join settles first", async () => {
    const { clock, manager, spec } = healthManager([UP]);
    const result = await manager.until({ spec, maxBlockMs: 60_000 });
    expect(result.blocked).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it("wakes an already-aborted sleep at once", async () => {
    const clock = new ManualClock();
    await clock.sleep({ ms: 1_000, signal: AbortSignal.abort() });
    expect(clock.pending).toBe(0);
    await systemClock.sleep({ ms: 60_000, signal: AbortSignal.abort() });
  });

  it("clears the system timer when the race is decided", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      const result = await raceSleep({ clock: systemClock, ms: 60_000, work: Promise.resolve("done") });
      expect(result).toBe("done");
      expect(clear).toHaveBeenCalled();
    } finally {
      clear.mockRestore();
    }
  });

  it("reports a sleep that ends first", async () => {
    const result = await raceSleep({ clock: systemClock, ms: 1, work: new Promise<never>(() => undefined) });
    expect(result).toBe("slept");
  });
});
