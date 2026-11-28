import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createExplainOp, type ExplainCtx } from "../ops/explain.js";
import type { Explainer, ExplainResult, Whitelist, LimitPolicy } from "../interfaces/index.js";

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: (n) => n ?? 10 };
const emptyWhitelist: Whitelist = { listContainers: () => [], hasContainer: (_n): _n is string => false };

type Q = { sql: string };
function makeCtx(result: ExplainResult = { estimatedRows: 100, totalCost: 12.5, planSummary: "Seq Scan" }): ExplainCtx<Q> {
  const explainer: Explainer<Q> = { explain: vi.fn(async () => result) };
  return {
    whitelist: emptyWhitelist, // intentionally empty — explain must bypass it
    reader: {},
    limit,
    trait: (name) => (name === "explainer" ? explainer : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ sql: z.string(), verbose: z.boolean().optional() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createExplainOp<Args, ExplainCtx<Q>, Q, Tag>>[0]>) {
  return createExplainOp<Args, ExplainCtx<Q>, Q, Tag>({
    argsSchema,
    extractQuery: (a) => ({ sql: a.sql }),
    extractVerbose: (a) => a.verbose === true,
    respond: {
      ok: ({ result, verbose }) => ({ kind: "ok", result, verbose }),
      invalidQuery: ({ message }) => ({ kind: "invalidQuery", message }),
    },
    ...extra,
  });
}

describe("createExplainOp — cost preview, whitelist-bypassing", () => {
  it("id/category + requires", () => {
    const op = makeOp();
    expect(op.id).toBe("explain");
    expect(op.category).toBe("Discovery");
    expect(op.requires).toEqual({ extras: ["explainer"] });
  });

  it("runs the explainer and returns ok even with an empty whitelist (bypass by design)", async () => {
    const ctx = makeCtx();
    const r = await makeOp().execute({ args: { sql: "SELECT 1" }, ctx });
    expect(r.kind).toBe("ok");
    expect((r.result as ExplainResult).estimatedRows).toBe(100);
    expect((ctx.trait("explainer").explain as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toEqual({ sql: "SELECT 1" });
  });

  it("propagates the verbose flag to respond.ok", async () => {
    const r = await makeOp().execute({ args: { sql: "SELECT 1", verbose: true }, ctx: makeCtx() });
    expect(r.verbose).toBe(true);
  });

  it("a guard short-circuits before the explainer (e.g. DDL reject)", async () => {
    const ctx = makeCtx();
    const guard = ({ query }: { query: Q }) => (/^\s*SELECT/i.test(query.sql) ? null : { kind: "invalidQuery", message: "SELECT-only" } as Tag);
    const r = await makeOp({ guards: [guard] }).execute({ args: { sql: "DROP TABLE t" }, ctx });
    expect(r).toEqual({ kind: "invalidQuery", message: "SELECT-only" });
    expect(ctx.trait("explainer").explain).not.toHaveBeenCalled();
  });

  it("a passing guard lets the explainer run", async () => {
    const ctx = makeCtx();
    const guard = ({ query }: { query: Q }) => (/^\s*SELECT/i.test(query.sql) ? null : { kind: "invalidQuery", message: "no" } as Tag);
    const r = await makeOp({ guards: [guard] }).execute({ args: { sql: "SELECT 1" }, ctx });
    expect(r.kind).toBe("ok");
    expect(ctx.trait("explainer").explain).toHaveBeenCalledOnce();
  });
});
