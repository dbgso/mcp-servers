import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createSearchOp, type SearchCtx } from "../ops/search.js";
import {
  asGuardedRedactSet,
  type FieldWhitelist, type FieldPolicy, type QueryGuard, type QueryGuardResult,
  type SearchReader, type SearchResult, type Redactor, type LimitPolicy,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;
type Pol = "expose" | "redact" | "exclude";
const cfg = { logs: { id: "expose" as Pol, msg: "expose" as Pol, ip: "redact" as Pol, tok: "exclude" as Pol } };

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
  whitelist?: FieldWhitelist;
} = {}): SearchCtx<string, SafeQ> {
  const guardResult: QueryGuardResult<SafeQ> = opts.guardResult ?? {
    safeQuery: { safe: "SELECT id" },
    redactFieldNames: asGuardedRedactSet(new Set(["ip"])),
    enforcedLimit: 25,
  };
  const queryGuard: QueryGuard<string, SafeQ> = {
    guard: vi.fn(() => { if (opts.guardThrows) throw opts.guardThrows; return guardResult; }),
  };
  const searchReader: SearchReader<string, SafeQ, Row> = {
    runSearch: vi.fn(async (): Promise<SearchResult<Row>> => ({ items: opts.items ?? [], meta: opts.meta })),
  };
  const redactor: Redactor<string, Row> = {
    redactOne: ({ record, redactFieldNames }) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, redactFieldNames?.has(k) ? "[R]" : v])),
    redactMany: ({ records, redactFieldNames, container }) => records.map((r) => redactor.redactOne({ container, record: r, redactFieldNames })),
  };
  return {
    whitelist: opts.whitelist ?? makeWhitelist(cfg), reader: {}, limit, dryRun: opts.dryRun,
    trait: (name) => (name === "queryGuard" ? queryGuard : name === "searchReader" ? searchReader : name === "redactor" ? redactor : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ container: z.string(), q: z.string() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createSearchOp<Args, SearchCtx<string, SafeQ>, string, SafeQ, Tag>>[0]>) {
  return createSearchOp<Args, SearchCtx<string, SafeQ>, string, SafeQ, Tag>({
    argsSchema,
    extractContainer: (a) => a.container,
    extractQueryInput: (a) => a.q,
    respond: {
      ok: ({ container, rows, rowCount, safeQuery, enforcedLimit, redactFieldNames, meta }) => ({ kind: "ok", container, rows, rowCount, safeQuery, enforcedLimit, redactFieldNames, meta }),
      notWhitelisted: ({ container, available }) => ({ kind: "notWhitelisted", container, available }),
      emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
      guardFailed: ({ error, code }) => ({ kind: "guardFailed", message: error.message, code }),
      dryRun: ({ container, safeQuery, enforcedLimit, redactFieldNames }) => ({ kind: "dryRun", container, safeQuery, enforcedLimit, redactFieldNames }),
    },
    ...extra,
  });
}
const baseArgs = { container: "logs", q: "SELECT *" };

describe("createSearchOp — composed flow + QueryGuard", () => {
  it("id + requires", () => {
    const op = makeOp();
    expect(op.id).toBe("search");
    expect(op.requires).toEqual({ reader: ["SearchReader"], extras: ["queryGuard", "redactor", "searchReader"] });
  });

  it("gates: notWhitelisted / emptyWhitelist", async () => {
    expect((await makeOp().execute({ args: { container: "x", q: "" }, ctx: makeCtx() })).kind).toBe("notWhitelisted");
    const emptyCtx = makeCtx({ whitelist: makeWhitelist({ audit: { a: "exclude" } }) });
    expect((await makeOp().execute({ args: { container: "audit", q: "" }, ctx: emptyCtx })).kind).toBe("emptyWhitelist");
  });

  it("preHook short-circuits before the guard", async () => {
    const reject: Tag = { kind: "blocked" };
    const ctx = makeCtx();
    const r = await makeOp({ preHooks: [() => reject] }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("queryGuard").guard).not.toHaveBeenCalled();
  });

  it("derives single-container whitelist (allowed/excluded/redacted) for the guard", async () => {
    const ctx = makeCtx();
    await makeOp().execute({ args: baseArgs, ctx });
    const passed = (ctx.trait("queryGuard").guard as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { whitelist: { allowed: string[]; excluded: string[]; redacted: string[] } };
    expect(passed.whitelist.allowed.sort()).toEqual(["id", "ip", "msg"]);
    expect(passed.whitelist.excluded).toEqual(["tok"]);
    expect(passed.whitelist.redacted).toEqual(["ip"]);
  });

  it("guard throwing → guardFailed with code preserved", async () => {
    const err = Object.assign(new Error("bad query"), { code: "E_SYNTAX" });
    const r = await makeOp().execute({ args: baseArgs, ctx: makeCtx({ guardThrows: err }) });
    expect(r).toEqual({ kind: "guardFailed", message: "bad query", code: "E_SYNTAX" });
  });

  it("dryRun short-circuits after guard, before the reader", async () => {
    const ctx = makeCtx({ dryRun: true });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("dryRun");
    expect(r.enforcedLimit).toBe(25);
    expect(ctx.trait("searchReader").runSearch).not.toHaveBeenCalled();
  });

  it("ok: reader gets safeQuery+enforcedLimit, rows redacted via guard's redactFieldNames, meta passed through", async () => {
    const ctx = makeCtx({ items: [{ id: 1, msg: "hi", ip: "1.2.3.4", tok: "s" }], meta: { scanned: 100 } });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("ok");
    expect((r.rows as Row[])[0]).toEqual({ id: 1, msg: "hi", ip: "[R]", tok: "s" }); // ip redacted per guard set
    expect(r.rowCount).toBe(1);
    expect(r.meta).toEqual({ scanned: 100 });
    const call = (ctx.trait("searchReader").runSearch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { query: SafeQ; limit: number };
    expect(call.query).toEqual({ safe: "SELECT id" });
    expect(call.limit).toBe(25);
  });
});
