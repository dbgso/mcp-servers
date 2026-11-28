import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createMultiSearchOp, type MultiSearchCtx } from "../ops/multi-search.js";
import {
  asGuardedRedactSet,
  type FieldWhitelist, type FieldPolicy, type QueryGuard, type QueryGuardResult,
  type MultiContainerSearchReader, type SearchResult, type Redactor, type LimitPolicy,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;
type Pol = "expose" | "redact" | "exclude";
// A and B overlap on id/email; A redacts email + excludes pw; B exposes email + adds phone.
const cfg = {
  logsA: { id: "expose" as Pol, email: "redact" as Pol, pw: "exclude" as Pol },
  logsB: { id: "expose" as Pol, email: "expose" as Pol, phone: "expose" as Pol },
};

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

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: (n) => Math.min(n ?? 10, 50) };

type SafeQ = { safe: string };
function makeCtx(opts: {
  guardResult?: QueryGuardResult<SafeQ>;
  guardThrows?: Error & { code?: string };
  items?: Row[];
  meta?: unknown;
  dryRun?: boolean;
} = {}): MultiSearchCtx<string, SafeQ> {
  const guardResult: QueryGuardResult<SafeQ> = opts.guardResult ?? {
    safeQuery: { safe: "Q" }, redactFieldNames: asGuardedRedactSet(new Set(["email"])), enforcedLimit: 25,
  };
  const queryGuard: QueryGuard<string, SafeQ> = { guard: vi.fn(() => { if (opts.guardThrows) throw opts.guardThrows; return guardResult; }) };
  const multiContainerSearchReader: MultiContainerSearchReader<string, SafeQ, Row> = {
    runSearch: vi.fn(async (): Promise<SearchResult<Row>> => ({ items: [] })),
    runMultiSearch: vi.fn(async (): Promise<SearchResult<Row>> => ({ items: opts.items ?? [], meta: opts.meta })),
  };
  const redactor: Redactor<string, Row> = {
    redactOne: ({ record, redactFieldNames }) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, redactFieldNames?.has(k) ? "[R]" : v])),
    redactMany: ({ records, redactFieldNames, container }) => records.map((r) => redactor.redactOne({ container, record: r, redactFieldNames })),
  };
  return {
    whitelist: makeWhitelist(cfg), reader: {}, limit, dryRun: opts.dryRun,
    trait: (name) => (name === "queryGuard" ? queryGuard : name === "multiContainerSearchReader" ? multiContainerSearchReader : name === "redactor" ? redactor : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ containers: z.array(z.string()), q: z.string() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createMultiSearchOp<Args, MultiSearchCtx<string, SafeQ>, string, SafeQ, Tag>>[0]>) {
  return createMultiSearchOp<Args, MultiSearchCtx<string, SafeQ>, string, SafeQ, Tag>({
    argsSchema,
    extractContainers: (a) => a.containers,
    extractQueryInput: (a) => a.q,
    respond: {
      ok: ({ containers, rows, rowCount, safeQuery, enforcedLimit, meta }) => ({ kind: "ok", containers, rows, rowCount, safeQuery, enforcedLimit, meta }),
      containersMissing: ({ missing }) => ({ kind: "containersMissing", missing }),
      guardFailed: ({ error, code }) => ({ kind: "guardFailed", message: error.message, code }),
      dryRun: ({ containers, safeQuery, enforcedLimit }) => ({ kind: "dryRun", containers, safeQuery, enforcedLimit }),
    },
    ...extra,
  });
}
const baseArgs = { containers: ["logsA", "logsB"], q: "Q" };

describe("createMultiSearchOp — N-container merge + guard", () => {
  it("id + requires (canonical default id 'search')", () => {
    const op = makeOp();
    expect(op.id).toBe("search");
    expect(op.requires).toEqual({ reader: ["MultiContainerSearchReader"], extras: ["queryGuard", "redactor", "multiContainerSearchReader"] });
  });

  it("preHook short-circuits before the merge", async () => {
    const reject: Tag = { kind: "badTimeRange" };
    const ctx = makeCtx();
    const r = await makeOp({ preHooks: [() => reject] }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("queryGuard").guard).not.toHaveBeenCalled();
  });

  it("containersMissing when any target is not whitelisted", async () => {
    const r = await makeOp().execute({ args: { containers: ["logsA", "nope"], q: "Q" }, ctx: makeCtx() });
    expect(r).toEqual({ kind: "containersMissing", missing: ["nope"] });
  });

  it("feeds the strictest-wins merged whitelist to the guard", async () => {
    const ctx = makeCtx();
    await makeOp().execute({ args: baseArgs, ctx });
    const passed = (ctx.trait("queryGuard").guard as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { whitelist: { allowed: string[]; excluded: string[]; redacted: string[] } };
    expect(passed.whitelist.allowed.sort()).toEqual(["email", "id"]); // intersection of queryable, minus excluded
    expect(passed.whitelist.excluded).toEqual(["pw"]); // union of excluded
    expect(passed.whitelist.redacted).toEqual(["email"]); // union of redacted ∩ allowed
  });

  it("guard throwing → guardFailed with code preserved", async () => {
    const err = Object.assign(new Error("bad"), { code: "E_GUARD" });
    const r = await makeOp().execute({ args: baseArgs, ctx: makeCtx({ guardThrows: err }) });
    expect(r).toEqual({ kind: "guardFailed", message: "bad", code: "E_GUARD" });
  });

  it("dryRun short-circuits after guard, before the reader", async () => {
    const ctx = makeCtx({ dryRun: true });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("dryRun");
    expect(ctx.trait("multiContainerSearchReader").runMultiSearch).not.toHaveBeenCalled();
  });

  it("ok: reader gets all containers+safeQuery+enforcedLimit, rows redacted, meta passthrough", async () => {
    const ctx = makeCtx({ items: [{ id: 1, email: "a@b", phone: "x" }], meta: { scanned: 9 } });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("ok");
    expect((r.rows as Row[])[0]).toEqual({ id: 1, email: "[R]", phone: "x" }); // email redacted via guard set
    expect(r.rowCount).toBe(1);
    expect(r.meta).toEqual({ scanned: 9 });
    const call = (ctx.trait("multiContainerSearchReader").runMultiSearch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { containers: string[]; query: SafeQ; limit: number };
    expect(call.containers).toEqual(["logsA", "logsB"]);
    expect(call.query).toEqual({ safe: "Q" });
    expect(call.limit).toBe(25);
  });
});
