import { describe, expect, it } from "vitest";
import { ManualClock } from "../watch/clock.js";
import { WatchManager } from "../watch/manager.js";
import { createFakeDeps, sequence, tick } from "./helpers.js";
import type { HttpResponse } from "../sources/types.js";

const URL = "https://example.com/healthz";

function healthWatch(overrides: Record<string, unknown> = {}) {
  return {
    source: "http",
    config: { url: URL, expect: { status: 200 } },
    intervalMs: 10_000,
    ...overrides,
  };
}

function managerWith(responses: HttpResponse[], options: Record<string, unknown> = {}) {
  const clock = new ManualClock();
  const manager = new WatchManager({
    clock,
    deps: createFakeDeps({ httpRequest: sequence(responses) }),
    ...options,
  });
  return { clock, manager };
}

const DOWN: HttpResponse = { status: 503, body: "down" };
const UP: HttpResponse = { status: 200, body: "ok" };

describe("WatchManager", () => {
  it("settles once the condition holds", async () => {
    const { clock, manager } = managerWith([DOWN, UP]);

    const watch = manager.create(healthWatch());
    await tick();
    expect(watch.status).toBe("waiting");
    expect(watch.polls).toBe(1);

    await clock.advance(10_000);
    expect(watch.status).toBe("satisfied");
    expect(watch.polls).toBe(2);
    expect(watch.finishedAt).toBe(10_000);

    const joined = await manager.join({ ids: [watch.id] });
    expect(joined.blocked).toBe(false);
  });

  it("stops at the deadline without sleeping past it", async () => {
    const { clock, manager } = managerWith([DOWN], { maxWatches: 5 });

    const watch = manager.create(healthWatch({ timeoutMs: 15_000 }));
    await tick();
    await clock.advance(15_000);

    expect(watch.status).toBe("timeout");
    expect(watch.polls).toBe(3);
    expect(watch.summary).toContain("timed out");
  });

  it("backs off and gives up after repeated errors", async () => {
    const clock = new ManualClock();
    let attempts = 0;
    const manager = new WatchManager({
      clock,
      maxConsecutiveErrors: 3,
      deps: createFakeDeps({
        httpRequest: () => {
          attempts += 1;
          throw new Error("connection refused");
        },
      }),
    });

    const watch = manager.create(healthWatch());
    await tick();
    expect(attempts).toBe(1);

    // Backoff doubles the base interval per consecutive error
    await clock.advance(20_000);
    expect(attempts).toBe(2);
    await clock.advance(40_000);

    expect(attempts).toBe(3);
    expect(watch.status).toBe("failed");
    expect(watch.summary).toContain("connection refused");
    expect(watch.lastError).toBe("connection refused");
  });

  it("resets the backoff after a successful poll", async () => {
    const clock = new ManualClock();
    let attempts = 0;
    const manager = new WatchManager({
      clock,
      deps: createFakeDeps({
        httpRequest: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("flaky");
          return DOWN;
        },
      }),
    });

    const watch = manager.create(healthWatch());
    await tick();
    await clock.advance(20_000);
    expect(watch.consecutiveErrors).toBe(0);
    expect(watch.lastError).toBeUndefined();

    await clock.advance(10_000);
    expect(attempts).toBe(3);
  });

  it("returns still-waiting when the block limit is reached first", async () => {
    const { clock, manager } = managerWith([DOWN]);

    const watch = manager.create(healthWatch());
    await tick();
    const pending = manager.join({ ids: [watch.id], maxBlockMs: 1_000 });
    await tick();
    await clock.advance(1_000);

    const result = await pending;
    expect(result.blocked).toBe(true);
    expect(result.watches[0].status).toBe("waiting");
  });

  it("joins on the first watch to settle in any mode", async () => {
    const clock = new ManualClock();
    const manager = new WatchManager({
      clock,
      deps: createFakeDeps({
        httpRequest: (request) => (request.url.endsWith("fast") ? UP : DOWN),
      }),
    });

    const slow = manager.create(healthWatch());
    const fast = manager.create(healthWatch({ config: { url: `${URL}/fast`, expect: { status: 200 } } }));
    await tick();

    const result = await manager.join({ ids: [slow.id, fast.id], mode: "any", maxBlockMs: 60_000 });
    expect(result.blocked).toBe(false);
    expect(fast.status).toBe("satisfied");
    expect(slow.status).toBe("waiting");
  });

  it("cancels one watch and every watch", async () => {
    const { manager } = managerWith([DOWN], { maxWatches: 5 });

    const first = manager.create(healthWatch());
    const second = manager.create(healthWatch());
    await tick();

    expect(manager.cancel(first.id).status).toBe("cancelled");
    const cancelled = manager.cancelAll();
    expect(cancelled).toHaveLength(1);
    expect(second.status).toBe("cancelled");
    // A settled watch keeps its first outcome
    expect(manager.cancel(first.id).status).toBe("cancelled");
  });

  it("creates and blocks in one call with until", async () => {
    const { clock, manager } = managerWith([UP]);

    const pending = manager.until({ spec: healthWatch() });
    await tick();
    await clock.advance(0);

    const result = await pending;
    expect(result.blocked).toBe(false);
    expect(result.watches[0].status).toBe("satisfied");
  });

  it("evaluates once without creating a watch", async () => {
    const { manager } = managerWith([UP]);

    const outcome = await manager.checkOnce({ source: "http", config: { url: URL, expect: { status: 200 } } });

    expect(outcome.satisfied).toBe(true);
    expect(manager.list()).toEqual([]);
  });

  it.each([
    {
      title: "unknown source",
      run: (manager: WatchManager) => manager.create({ source: "nope", config: {} }),
      message: "Unknown source",
    },
    {
      title: "invalid config",
      run: (manager: WatchManager) => manager.create({ source: "http", config: {} }),
      message: "Invalid config",
    },
    {
      title: "unknown watch id",
      run: (manager: WatchManager) => manager.requireWatch("w_99"),
      message: "Unknown watch id",
    },
  ])("rejects $title", ({ run, message }) => {
    const { manager } = managerWith([UP]);
    expect(() => run(manager)).toThrow(message);
  });

  it.each([
    { title: "unknown source", source: "nope", config: {}, message: "Unknown source" },
    { title: "invalid config", source: "http", config: {}, message: "Invalid config" },
  ])("rejects $title in check", async ({ source, config, message }) => {
    const { manager } = managerWith([UP]);
    await expect(manager.checkOnce({ source, config })).rejects.toThrow(message);
  });

  it("refuses to exceed the active watch limit", async () => {
    const { manager } = managerWith([DOWN], { maxWatches: 1 });

    const first = manager.create(healthWatch());
    await tick();
    expect(() => manager.create(healthWatch())).toThrow("Too many active watches");

    manager.cancel(first.id);
    expect(() => manager.create(healthWatch())).not.toThrow();
  });

  it("keeps settled watches readable", async () => {
    const { clock, manager } = managerWith([UP]);

    const watch = manager.create(healthWatch({ label: "health" }));
    await tick();

    expect(manager.get(watch.id)?.label).toBe("health");
    expect(manager.list()).toHaveLength(1);
    expect(manager.now()).toBe(clock.now());
  });

  it("clamps the polling interval to the source minimum", async () => {
    const { manager } = managerWith([DOWN]);

    const watch = manager.create(healthWatch({ intervalMs: 1 }));
    await tick();

    expect(watch.intervalMs).toBe(5_000);
  });

  it("keeps only the most recent events", async () => {
    const clock = new ManualClock();
    let attempts = 0;
    const manager = new WatchManager({
      clock,
      maxConsecutiveErrors: 1_000,
      deps: createFakeDeps({
        httpRequest: () => {
          attempts += 1;
          throw new Error(`boom ${attempts}`);
        },
      }),
    });

    const watch = manager.create(healthWatch({ intervalMs: 5_000, timeoutMs: 200_000 }));
    await tick();
    for (let round = 0; round < 25; round += 1) {
      await clock.advance(300_000);
    }

    expect(watch.events.length).toBeLessThanOrEqual(20);
    expect(watch.status).toBe("timeout");
  });
});

describe("ManualClock", () => {
  it("wakes sleeps in due order and reports pending ones", async () => {
    const clock = new ManualClock(1_000);
    const woken: string[] = [];

    void clock.sleep(500).then(() => woken.push("short"));
    void clock.sleep(2_000).then(() => woken.push("long"));
    expect(clock.pending).toBe(2);

    await clock.advance(600);
    expect(woken).toEqual(["short"]);
    expect(clock.now()).toBe(1_600);

    await clock.advance(2_000);
    expect(woken).toEqual(["short", "long"]);
  });
});
