import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createFindByRangeOp, type FindByRangeCtx } from "../ops/find-by-range.js";
import type {
  FieldWhitelist, FieldPolicy, RangeReader, Redactor, LimitPolicy, Explainer, ExplainResult,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;
type Pol = "expose" | "redact" | "exclude";
const cfg = { events: { id: "expose" as Pol, ts: "expose" as Pol, note: "redact" as Pol, pw: "exclude" as Pol } };

function makeWhitelist(c: Record<string, Record<string, Pol>>): FieldWhitelist {
  const has = (n: string): n is string => Object.prototype.hasOwnProperty.call(c, n);
  return {
    listContainers: () => Object.keys(c).sort(),
    hasContainer: has,
    getContainer: (n) => (has(n) ? { fields: Object.fromEntries(Object.entries(c[n]).map(([f, p]) => [f, { select: p } as FieldPolicy])) } : undefined),
    getSelectableFields: (x) => Object.entries(c[x] ?? {}).filter(([, p]) => p !== "exclude").map(([f]) => f),
    getFieldPolicy: ({ container, field }) => (has(container) ? (c[container][field] ?? "redact") : "exclude"),
    isEmpty: (x) => has(x) && Object.values(c[x]).every((p) => p === "exclude"),
  };
}
const redactor: Redactor<string, Row> = {
  redactOne: ({ container, record }) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, cfg[container as keyof typeof cfg]?.[k as never] === "redact" ? "[R]" : v])),
  redactMany: ({ container, records }) => records.map((r) => redactor.redactOne({ container, record: r })),
};
const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: (n) => Math.min(n ?? 10, 50) };

function makeCtx(rows: Row[], estimatedRows: number | null = 1): FindByRangeCtx<number> {
  const rangeReader: RangeReader<string, number, Row> = { readByRange: vi.fn(async () => rows) };
  const rangeExplainer: Explainer<unknown> = {
    explain: vi.fn(async (): Promise<ExplainResult> => ({ estimatedRows, totalCost: null, planSummary: "x" })),
  };
  return {
    whitelist: makeWhitelist(cfg), reader: {}, limit,
    trait: (name) => (name === "rangeReader" ? rangeReader : name === "redactor" ? redactor : name === "rangeExplainer" ? rangeExplainer : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ table: z.string(), field: z.string(), from: z.number(), to: z.number(), bypass: z.boolean().optional() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createFindByRangeOp<Args, FindByRangeCtx<number>, number, Tag>>[0]>) {
  return createFindByRangeOp<Args, FindByRangeCtx<number>, number, Tag>({
    argsSchema,
    extractContainer: (a) => a.table, extractField: (a) => a.field, extractFrom: (a) => a.from, extractTo: (a) => a.to,
    extractBypassExplain: (a) => a.bypass === true,
    respond: {
      ok: ({ container, rows, count, estimate }) => ({ kind: "ok", container, rows, count, estimate }),
      notWhitelisted: ({ container }) => ({ kind: "notWhitelisted", container }),
      emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
      fieldNotSelectable: ({ field }) => ({ kind: "fieldNotSelectable", field }),
      blockedByExplain: ({ estimate, threshold }) => ({ kind: "blocked", estimate, threshold }),
    },
    ...extra,
  });
}
const baseArgs = { table: "events", field: "ts", from: 0, to: 100 };

describe("createFindByRangeOp — composed flow + EXPLAIN gate", () => {
  it("id + requires (rangeExplainer only when explainThreshold set)", () => {
    expect(makeOp().id).toBe("get_by_range");
    expect(makeOp().requires).toEqual({ extras: ["redactor", "rangeReader"] });
    expect(makeOp({ explainThreshold: 100 }).requires).toEqual({ extras: ["redactor", "rangeReader", "rangeExplainer"] });
  });

  it("gates: notWhitelisted / emptyWhitelist / fieldNotSelectable", async () => {
    expect((await makeOp().execute({ args: { ...baseArgs, table: "ghost" }, ctx: makeCtx([]) })).kind).toBe("notWhitelisted");
    const emptyCtx = { ...makeCtx([]), whitelist: makeWhitelist({ audit: { a: "exclude" } }) } as FindByRangeCtx<number>;
    expect((await makeOp().execute({ args: { ...baseArgs, table: "audit", field: "a" }, ctx: emptyCtx })).kind).toBe("emptyWhitelist");
    const r = await makeOp().execute({ args: { ...baseArgs, field: "pw" }, ctx: makeCtx([]) });
    expect(r.kind).toBe("fieldNotSelectable");
  });

  it("ok without explain: reads, redacts, estimate undefined", async () => {
    const r = await makeOp().execute({ args: baseArgs, ctx: makeCtx([{ id: 1, ts: 5, note: "x", pw: "s" }]) });
    expect(r.kind).toBe("ok");
    expect((r.rows as Row[])[0]).toEqual({ id: 1, ts: 5, note: "[R]", pw: "s" });
    expect(r.estimate).toBeUndefined();
  });

  it("EXPLAIN gate blocks when estimate exceeds threshold", async () => {
    const r = await makeOp({ explainThreshold: 100 }).execute({ args: baseArgs, ctx: makeCtx([], 5000) });
    expect(r.kind).toBe("blocked");
    expect((r.estimate as ExplainResult).estimatedRows).toBe(5000);
    expect(r.threshold).toBe(100);
  });

  it("bypass skips the EXPLAIN block", async () => {
    const ctx = makeCtx([{ id: 1, ts: 5 }], 5000);
    const r = await makeOp({ explainThreshold: 100 }).execute({ args: { ...baseArgs, bypass: true }, ctx });
    expect(r.kind).toBe("ok");
    expect((r.estimate as ExplainResult).estimatedRows).toBe(5000); // ran explain but didn't block
  });

  it("under-threshold estimate proceeds to ok with estimate included", async () => {
    const r = await makeOp({ explainThreshold: 100 }).execute({ args: baseArgs, ctx: makeCtx([{ id: 1, ts: 5 }], 3) });
    expect(r.kind).toBe("ok");
    expect((r.estimate as ExplainResult).estimatedRows).toBe(3);
  });

  it("preHook short-circuits before the limit clamp / reader", async () => {
    const reject: Tag = { kind: "blockedByHook" };
    const ctx = makeCtx([{ id: 1, ts: 5 }]);
    const r = await makeOp({ preHooks: [() => reject] }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("rangeReader").readByRange).not.toHaveBeenCalled();
  });

  it("throws when explainThreshold triggers but respond.blockedByExplain is missing", async () => {
    const op = makeOp({
      explainThreshold: 100,
      respond: {
        ok: ({ container, rows, count, estimate }) => ({ kind: "ok", container, rows, count, estimate }),
        notWhitelisted: ({ container }) => ({ kind: "notWhitelisted", container }),
        emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
        fieldNotSelectable: ({ field }) => ({ kind: "fieldNotSelectable", field }),
      },
    });
    await expect(op.execute({ args: baseArgs, ctx: makeCtx([], 5000) })).rejects.toThrow(/blockedByExplain is not defined/);
  });

  it("throws when explainThreshold is set but the rangeExplainer trait is absent", async () => {
    const ctxNoExplainer: FindByRangeCtx<number> = {
      whitelist: makeWhitelist(cfg), reader: {}, limit,
      trait: (name) => (name === "rangeReader" ? { readByRange: vi.fn(async () => []) } : name === "redactor" ? redactor : name === "rangeExplainer" ? undefined : (() => { throw new Error(String(name)); })()) as never,
    };
    await expect(makeOp({ explainThreshold: 100 }).execute({ args: baseArgs, ctx: ctxNoExplainer })).rejects.toThrow(/rangeExplainer'\) is missing/);
  });
});
