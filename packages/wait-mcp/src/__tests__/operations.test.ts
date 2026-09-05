import { describe, expect, it } from "vitest";
import type { ToolHandler } from "mcp-shared";
import { allOperations } from "../operations/index.js";
import { nextJoinHint } from "../operations/format.js";
import { createToolRegistry, getToolRegistry } from "../tools/index.js";
import { ManualClock } from "../watch/clock.js";
import { WatchManager } from "../watch/manager.js";
import { createFakeDeps, jsonOf, sequence, textOf, tick } from "./helpers.js";
import type { HttpResponse } from "../sources/types.js";

const URL = "https://example.com/healthz";
const DOWN: HttpResponse = { status: 503, body: "down" };
const UP: HttpResponse = { status: 200, body: "ok" };

const healthConfig = { url: URL, expect: { status: 200 } };

function setup(responses: HttpResponse[]) {
  const clock = new ManualClock();
  const manager = new WatchManager({
    clock,
    deps: createFakeDeps({ httpRequest: sequence(responses) }),
  });
  const registry = createToolRegistry(manager);
  return {
    clock,
    manager,
    describe: registry.getHandler("describe") as ToolHandler,
    execute: registry.getHandler("execute") as ToolHandler,
  };
}

describe("tool surface", () => {
  it("exposes describe and execute without a name prefix", () => {
    const registry = createToolRegistry(new WatchManager({ clock: new ManualClock() }));
    expect(registry.getAllTools().map((tool) => tool.name)).toEqual(["describe", "execute"]);
  });

  it("reuses one registry for the process", () => {
    expect(getToolRegistry()).toBe(getToolRegistry());
  });

  it("lists every operation grouped by category", async () => {
    const { describe: describeHandler } = setup([UP]);
    const text = textOf(await describeHandler.execute({}));

    expect(text).toContain("# Wait Operations");
    for (const operation of allOperations) {
      expect(text).toContain(`**${operation.id}**`);
    }
  });

  it("shows one operation's schema", async () => {
    const { describe: describeHandler } = setup([UP]);
    const text = textOf(await describeHandler.execute({ operation: "until" }));
    expect(text).toContain("# until");
    expect(text).toContain("max_block_ms");
  });

  it("rejects an unknown operation", async () => {
    const { execute } = setup([UP]);
    const result = await execute.execute({ operation: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unknown operation");
  });

  it("rejects params that do not match the operation schema", async () => {
    const { execute } = setup([UP]);
    const result = await execute.execute({ operation: "until", params: { source: "http" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Invalid params");
  });
});

describe("wait operations", () => {
  it("until returns the settled watch", async () => {
    const { execute, clock } = setup([UP]);

    const pending = execute.execute({
      operation: "until",
      params: { source: "http", config: healthConfig, label: "health" },
    });
    await tick();
    await clock.advance(0);

    const body = jsonOf(await pending);
    expect(body).toMatchObject({ id: "w_1", status: "satisfied", label: "health", polls: 1 });
    expect(body.next).toBeUndefined();
  });

  it("until hands back a resumable watch when it blocks", async () => {
    const { execute, clock } = setup([DOWN]);

    const pending = execute.execute({
      operation: "until",
      params: { source: "http", config: healthConfig, max_block_ms: 1_000 },
    });
    await tick();
    await clock.advance(1_000);

    const body = jsonOf(await pending);
    expect(body).toMatchObject({ status: "waiting" });
    expect(body.next).toBe(nextJoinHint(["w_1"]));
  });

  it("watch returns immediately and join blocks on it", async () => {
    const { execute, clock } = setup([DOWN, UP]);

    const created = jsonOf(await execute.execute({
      operation: "watch",
      params: { source: "http", config: healthConfig, interval_ms: 10_000 },
    }));
    expect(created).toMatchObject({ id: "w_1", status: "waiting" });

    const pending = execute.execute({ operation: "join", params: { ids: ["w_1"] } });
    await tick();
    await clock.advance(10_000);

    expect(jsonOf(await pending)).toMatchObject({ status: "satisfied" });
  });

  it("join reports several watches together", async () => {
    const { execute, clock } = setup([UP]);

    await execute.execute({ operation: "watch", params: { source: "http", config: healthConfig } });
    await execute.execute({ operation: "watch", params: { source: "http", config: healthConfig } });
    await tick();

    const pending = execute.execute({ operation: "join", params: { ids: ["w_1", "w_2"], mode: "any" } });
    await tick();
    await clock.advance(0);

    const body = jsonOf<{ watches: unknown[] }>(await pending);
    expect(body.watches).toHaveLength(2);
    expect(body).toHaveProperty("blocked", false);
  });

  it("join rejects an unknown id", async () => {
    const { execute } = setup([UP]);
    const result = await execute.execute({ operation: "join", params: { ids: ["w_9"] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unknown watch id");
  });

  it("check evaluates once without creating a watch", async () => {
    const { execute, manager } = setup([UP]);

    const body = jsonOf(await execute.execute({
      operation: "check",
      params: { source: "http", config: healthConfig },
    }));

    expect(body).toMatchObject({ source: "http", satisfied: true });
    expect(manager.list()).toEqual([]);
  });

  it("check reports an unknown source as an error", async () => {
    const { execute } = setup([UP]);
    const result = await execute.execute({ operation: "check", params: { source: "nope", config: {} } });
    expect(result.isError).toBe(true);
  });
});

describe("manage operations", () => {
  it("lists watches and inspects one", async () => {
    const { execute, clock } = setup([DOWN, UP]);

    await execute.execute({
      operation: "watch",
      params: { source: "http", config: healthConfig, interval_ms: 10_000 },
    });
    await tick();

    const listed = jsonOf<{ total: number; watches: { next?: string }[] }>(
      await execute.execute({ operation: "status", params: {} }),
    );
    expect(listed.total).toBe(1);
    expect(listed.watches[0].next).toBe(nextJoinHint(["w_1"]));

    await clock.advance(10_000);
    const detail = jsonOf<{ status: string; events?: string[]; details?: unknown }>(
      await execute.execute({ operation: "status", params: { id: "w_1" } }),
    );
    expect(detail.status).toBe("satisfied");
    expect(detail.events).toBeDefined();
    expect(detail.details).toBeDefined();
  });

  it("hides settled watches when asked", async () => {
    const { execute, clock } = setup([UP]);

    await execute.execute({ operation: "watch", params: { source: "http", config: healthConfig } });
    await tick();
    await clock.advance(0);

    const body = jsonOf<{ total: number }>(
      await execute.execute({ operation: "status", params: { include_finished: false } }),
    );
    expect(body.total).toBe(0);
  });

  it("reports an unknown id from status", async () => {
    const { execute } = setup([UP]);
    const result = await execute.execute({ operation: "status", params: { id: "w_9" } });
    expect(result.isError).toBe(true);
  });

  it("cancels one watch", async () => {
    const { execute } = setup([DOWN]);

    await execute.execute({ operation: "watch", params: { source: "http", config: healthConfig } });
    await tick();

    expect(jsonOf(await execute.execute({ operation: "cancel", params: { id: "w_1" } }))).toMatchObject({
      status: "cancelled",
    });
  });

  it("cancels every waiting watch", async () => {
    const { execute } = setup([DOWN]);

    await execute.execute({ operation: "watch", params: { source: "http", config: healthConfig } });
    await execute.execute({ operation: "watch", params: { source: "http", config: healthConfig } });
    await tick();

    const body = jsonOf<{ cancelled: number }>(
      await execute.execute({ operation: "cancel", params: { all: true } }),
    );
    expect(body.cancelled).toBe(2);
  });

  it.each([
    { title: "no target", params: {}, message: "Specify" },
    { title: "both targets", params: { id: "w_1", all: true }, message: "not both" },
  ])("rejects cancel with $title", async ({ params, message }) => {
    const { execute } = setup([DOWN]);
    const result = await execute.execute({ operation: "cancel", params });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(message);
  });

  it("lists sources and one source's schema", async () => {
    const { execute } = setup([UP]);

    const listing = jsonOf<{ total: number; categories: unknown[] }>(
      await execute.execute({ operation: "sources", params: {} }),
    );
    expect(listing.total).toBe(5);
    expect(listing.categories).toHaveLength(4);

    const detail = jsonOf<{ id: string; config_schema: unknown }>(
      await execute.execute({ operation: "sources", params: { source: "github_checks" } }),
    );
    expect(detail.id).toBe("github_checks");
    expect(detail.config_schema).toBeDefined();
  });

  it("reports an unknown source", async () => {
    const { execute } = setup([UP]);
    const result = await execute.execute({ operation: "sources", params: { source: "nope" } });
    expect(result.isError).toBe(true);
  });
});
