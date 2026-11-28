import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createFindByPkOp, type FindByPkCtx } from "../ops/find-by-pk.js";
import type { FieldWhitelist, FieldPolicy, PointReader, Redactor, LimitPolicy } from "../interfaces/index.js";

type Row = Record<string, unknown>;
type Pol = "expose" | "redact" | "exclude";

// ---- in-memory trait doubles ----
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

// Redactor that masks "redact"-policy fields with "[REDACTED]".
function makeRedactor(cfg: Record<string, Record<string, Pol>>): Redactor<string, Row> {
  const redactOne = ({ container, record }: { container: string; record: Row }): Row => {
    const out: Row = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = cfg[container]?.[k] === "redact" ? "[REDACTED]" : v;
    }
    return out;
  };
  return { redactOne, redactMany: ({ container, records }) => records.map((r) => redactOne({ container, record: r })) };
}

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 100, clamp: (n) => n ?? 10 };

function makeCtx(params: {
  cfg: Record<string, Record<string, Pol>>;
  store: Record<string, Row>; // key = `${container}:${id}`
}): FindByPkCtx {
  const reader: PointReader<string, string | number, Row> = {
    readOne: async ({ container, key }) => params.store[`${container}:${String(key)}`] ?? null,
  };
  const redactor = makeRedactor(params.cfg);
  return {
    whitelist: makeWhitelist(params.cfg),
    reader,
    limit,
    trait: (name) => {
      if (name === "redactor") return redactor as never;
      throw new Error(`unexpected trait ${String(name)}`);
    },
  };
}

const argsSchema = z.object({ table: z.string(), id: z.number() });
type Args = z.infer<typeof argsSchema>;

// respond returns tagged objects so tests can assert the taken branch.
type Tag =
  | { kind: "ok"; container: string; row: Row }
  | { kind: "notFound"; container: string }
  | { kind: "notWhitelisted"; container: string; available: readonly string[] }
  | { kind: "emptyWhitelist"; container: string };

function makeOp(extra?: Partial<Parameters<typeof createFindByPkOp<Args, FindByPkCtx, Tag>>[0]>) {
  return createFindByPkOp<Args, FindByPkCtx, Tag>({
    argsSchema,
    extractContainer: (a) => a.table,
    extractKey: (a) => a.id,
    respond: {
      ok: ({ container, row }) => ({ kind: "ok", container, row }),
      notFound: ({ container }) => ({ kind: "notFound", container }),
      notWhitelisted: ({ container, available }) => ({ kind: "notWhitelisted", container, available }),
      emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
    },
    ...extra,
  });
}

describe("createFindByPkOp — composed flow", () => {
  const cfg = { users: { id: "expose" as Pol, email: "redact" as Pol, pw: "exclude" as Pol } };

  it("declares its trait requirements and default id", () => {
    const op = makeOp();
    expect(op.id).toBe("get_by_pk");
    expect(op.requires).toEqual({ reader: ["PointReader"], extras: ["redactor"] });
  });

  it("refuses a non-whitelisted container", async () => {
    const op = makeOp();
    const ctx = makeCtx({ cfg, store: {} });
    const r = (await op.execute({ args: { table: "secrets", id: 1 }, ctx })) as Tag;
    expect(r).toEqual({ kind: "notWhitelisted", container: "secrets", available: ["users"] });
  });

  it("refuses an empty-whitelist container", async () => {
    const op = makeOp();
    const ctx = makeCtx({ cfg: { audit: { a: "exclude" } }, store: {} });
    const r = (await op.execute({ args: { table: "audit", id: 1 }, ctx })) as Tag;
    expect(r.kind).toBe("emptyWhitelist");
  });

  it("returns notFound when the reader yields null", async () => {
    const op = makeOp();
    const ctx = makeCtx({ cfg, store: {} });
    const r = (await op.execute({ args: { table: "users", id: 9 }, ctx })) as Tag;
    expect(r.kind).toBe("notFound");
  });

  it("projects selectable fields, redacts, and responds ok", async () => {
    const op = makeOp();
    const ctx = makeCtx({ cfg, store: { "users:1": { id: 1, email: "a@b.c", pw: "secret" } } });
    const spy = vi.spyOn(ctx.reader, "readOne");
    const r = (await op.execute({ args: { table: "users", id: 1 }, ctx })) as Tag & { kind: "ok" };
    expect(r.kind).toBe("ok");
    expect(r.row).toEqual({ id: 1, email: "[REDACTED]", pw: "secret" }); // redactor masks email
    // selectable fields (non-exclude) passed to the reader
    expect(spy.mock.calls[0][0].fields.sort()).toEqual(["email", "id"]);
  });

  it("a preHook can short-circuit before the read", async () => {
    const reject: Tag = { kind: "notFound", container: "users" };
    const op = makeOp({ preHooks: [() => reject] });
    const ctx = makeCtx({ cfg, store: { "users:1": { id: 1 } } });
    const spy = vi.spyOn(ctx.reader, "readOne");
    const r = (await op.execute({ args: { table: "users", id: 1 }, ctx })) as Tag;
    expect(r).toBe(reject);
    expect(spy).not.toHaveBeenCalled();
  });
});
