import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createJsonSearchOp, type JsonSearchCtx } from "../ops/json-search.js";
import type { FieldWhitelist, FieldPolicy, JsonPathReader, Redactor, LimitPolicy } from "../interfaces/index.js";

type Row = Record<string, unknown>;
type Pol = "expose" | "redact" | "exclude";
const cfg = { docs: { id: "expose" as Pol, payload: "expose" as Pol, owner: "redact" as Pol, secret: "exclude" as Pol } };

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

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: vi.fn((n?: number) => Math.min(n ?? 10, 50)) };

function makeCtx(rows: Row[]): JsonSearchCtx {
  const jsonPathReader: JsonPathReader<string, Row> = { readByJsonPath: vi.fn(async () => rows) };
  const redactor: Redactor<string, Row> = {
    redactOne: ({ record }) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, cfg.docs[k as keyof typeof cfg.docs] === "redact" ? "[R]" : v])),
    redactMany: ({ container, records }) => records.map((r) => redactor.redactOne({ container, record: r })),
  };
  return {
    whitelist: makeWhitelist(cfg), reader: {}, limit,
    trait: (name) => (name === "jsonPathReader" ? jsonPathReader : name === "redactor" ? redactor : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ container: z.string(), field: z.string(), path: z.string(), value: z.unknown(), limit: z.number().optional() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createJsonSearchOp<Args, JsonSearchCtx, Tag>>[0]>) {
  return createJsonSearchOp<Args, JsonSearchCtx, Tag>({
    argsSchema,
    extractContainer: (a) => a.container,
    extractField: (a) => a.field,
    extractPath: (a) => a.path,
    extractValue: (a) => a.value,
    extractLimit: (a) => a.limit,
    respond: {
      ok: ({ container, field, path, rows, count, extra }) => ({ kind: "ok", container, field, path, rows, count, ...extra }),
      notWhitelisted: ({ container, available }) => ({ kind: "notWhitelisted", container, available }),
      emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
      fieldNotSelectable: ({ field, allowedFields }) => ({ kind: "fieldNotSelectable", field, allowedFields }),
    },
    ...extra,
  });
}
const baseArgs = { container: "docs", field: "payload", path: "$.a.b", value: "x" };

describe("createJsonSearchOp — JSON-path exact match", () => {
  it("id/category + requires", () => {
    const op = makeOp();
    expect(op.id).toBe("json_search");
    expect(op.category).toBe("Read");
    expect(op.requires).toEqual({ extras: ["redactor", "jsonPathReader"] });
  });

  it("gates: notWhitelisted / emptyWhitelist / fieldNotSelectable(excluded field)", async () => {
    expect((await makeOp().execute({ args: { ...baseArgs, container: "x" }, ctx: makeCtx([]) })).kind).toBe("notWhitelisted");
    const emptyCtx = { ...makeCtx([]), whitelist: makeWhitelist({ audit: { a: "exclude" } }) } as JsonSearchCtx;
    expect((await makeOp().execute({ args: { ...baseArgs, container: "audit" }, ctx: emptyCtx })).kind).toBe("emptyWhitelist");
    const r = await makeOp().execute({ args: { ...baseArgs, field: "secret" }, ctx: makeCtx([]) });
    expect(r.kind).toBe("fieldNotSelectable");
    expect(r.allowedFields).toEqual(expect.arrayContaining(["id", "payload", "owner"]));
  });

  it("preHook short-circuits before the reader", async () => {
    const reject: Tag = { kind: "notJsonColumn" };
    const ctx = makeCtx([{ id: 1 }]);
    const r = await makeOp({ preHooks: [() => reject] }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("jsonPathReader").readByJsonPath).not.toHaveBeenCalled();
  });

  it("reads with clamped limit + allowed fields + path/value, redacts, responds ok", async () => {
    const ctx = makeCtx([{ id: 1, payload: "p", owner: "me", secret: "s" }]);
    const r = await makeOp().execute({ args: { ...baseArgs, limit: 999 }, ctx });
    expect(r.kind).toBe("ok");
    expect(r.count).toBe(1);
    expect((r.rows as Row[])[0]).toEqual({ id: 1, payload: "p", owner: "[R]", secret: "s" }); // owner redacted
    const call = (ctx.trait("jsonPathReader").readByJsonPath as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { limit: number; fields: string[]; path: string; value: unknown };
    expect(call.limit).toBe(50); // clamped
    expect(call.path).toBe("$.a.b");
    expect(call.value).toBe("x");
    expect(call.fields.sort()).toEqual(["id", "owner", "payload"]);
  });

  it("postHook merges extra into ok payload", async () => {
    const ctx = makeCtx([{ id: 1 }]);
    const r = await makeOp({ postHook: () => ({ warning: "unindexed json path" }) }).execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("ok");
    expect(r.warning).toBe("unindexed json path");
  });
});
