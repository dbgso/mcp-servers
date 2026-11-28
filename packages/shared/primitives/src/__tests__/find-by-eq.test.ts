import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createFindByEqOp, type FindByEqCtx } from "../ops/find-by-eq.js";
import type { FieldWhitelist, FieldPolicy, EqReader, Redactor, LimitPolicy } from "../interfaces/index.js";

type Row = Record<string, unknown>;
type Pol = "expose" | "redact" | "exclude";

function makeWhitelist(cfg: Record<string, Record<string, Pol>>): FieldWhitelist {
  const has = (n: string): n is string => Object.prototype.hasOwnProperty.call(cfg, n);
  return {
    listContainers: () => Object.keys(cfg).sort(),
    hasContainer: has,
    getContainer: (n) => {
      if (!has(n)) return undefined;
      const fields: Record<string, FieldPolicy> = {};
      for (const [f, p] of Object.entries(cfg[n])) fields[f] = { select: p };
      return { fields };
    },
    getSelectableFields: (c) => Object.entries(cfg[c] ?? {}).filter(([, p]) => p !== "exclude").map(([f]) => f),
    getFieldPolicy: ({ container, field }) => (has(container) ? (cfg[container][field] ?? "redact") : "exclude"),
    isEmpty: (c) => has(c) && Object.values(cfg[c]).every((p) => p === "exclude"),
  };
}

function makeRedactor(cfg: Record<string, Record<string, Pol>>): Redactor<string, Row> {
  const one = (container: string, r: Row): Row =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cfg[container]?.[k] === "redact" ? "[R]" : v]));
  return { redactOne: ({ container, record }) => one(container, record), redactMany: ({ container, records }) => records.map((r) => one(container, r)) };
}

const cfg = { users: { id: "expose" as Pol, email: "redact" as Pol, pw: "exclude" as Pol } };
const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: vi.fn((n?: number) => Math.min(n ?? 10, 50)) };

function makeCtx(rows: Row[]): FindByEqCtx {
  const eqReader: EqReader<string, Row> = { readByEq: vi.fn(async () => rows) };
  const redactor = makeRedactor(cfg);
  return {
    whitelist: makeWhitelist(cfg),
    reader: {},
    limit,
    trait: (name) => (name === "eqReader" ? eqReader : name === "redactor" ? redactor : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ table: z.string(), field: z.string(), value: z.unknown(), limit: z.number().optional() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createFindByEqOp<Args, FindByEqCtx, Tag>>[0]>) {
  return createFindByEqOp<Args, FindByEqCtx, Tag>({
    argsSchema,
    extractContainer: (a) => a.table,
    extractField: (a) => a.field,
    extractValue: (a) => a.value,
    extractLimit: (a) => a.limit,
    respond: {
      ok: ({ container, rows, count, extra }) => ({ kind: "ok", container, rows, count, ...extra }),
      notFound: ({ container }) => ({ kind: "notFound", container }),
      notWhitelisted: ({ container, available }) => ({ kind: "notWhitelisted", container, available }),
      emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
      fieldNotSelectable: ({ field, allowedFields }) => ({ kind: "fieldNotSelectable", field, allowedFields }),
    },
    ...extra,
  });
}

describe("createFindByEqOp — composed flow", () => {
  it("declares traits + default id", () => {
    const op = makeOp();
    expect(op.id).toBe("get_by_eq");
    expect(op.requires).toEqual({ extras: ["redactor", "eqReader"] });
  });

  it("gates: notWhitelisted / emptyWhitelist / fieldNotSelectable", async () => {
    expect((await makeOp().execute({ args: { table: "x", field: "id", value: 1 }, ctx: makeCtx([]) })).kind).toBe("notWhitelisted");
    const emptyCtx = { ...makeCtx([]), whitelist: makeWhitelist({ audit: { a: "exclude" } }) } as FindByEqCtx;
    expect((await makeOp().execute({ args: { table: "audit", field: "a", value: 1 }, ctx: emptyCtx })).kind).toBe("emptyWhitelist");
    const r = await makeOp().execute({ args: { table: "users", field: "pw", value: "x" }, ctx: makeCtx([]) });
    expect(r.kind).toBe("fieldNotSelectable");
    expect(r.allowedFields).toEqual(expect.arrayContaining(["id", "email"]));
  });

  it("reads with clamped limit + selectable fields, redacts, responds ok", async () => {
    const ctx = makeCtx([{ id: 1, email: "a@b", pw: "s" }]);
    const r = await makeOp().execute({ args: { table: "users", field: "id", value: 1, limit: 999 }, ctx });
    expect(r.kind).toBe("ok");
    expect(r.count).toBe(1);
    expect((r.rows as Row[])[0]).toEqual({ id: 1, email: "[R]", pw: "s" }); // email redacted
    const call = (ctx.trait("eqReader").readByEq as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { limit: number; fields: string[] };
    expect(call.limit).toBe(50); // clamped to maxLimit
    expect(call.fields.sort()).toEqual(["email", "id"]);
  });

  it("preHook short-circuits before read", async () => {
    const reject: Tag = { kind: "blocked" };
    const ctx = makeCtx([{ id: 1 }]);
    const r = await makeOp({ preHooks: [() => reject] }).execute({ args: { table: "users", field: "id", value: 1 }, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("eqReader").readByEq).not.toHaveBeenCalled();
  });

  it("postHook merges extra into ok payload", async () => {
    const ctx = makeCtx([{ id: 1 }]);
    const r = await makeOp({ postHook: () => ({ warning: "unindexed" }) }).execute({ args: { table: "users", field: "id", value: 1 }, ctx });
    expect(r.kind).toBe("ok");
    expect(r.warning).toBe("unindexed");
  });
});
