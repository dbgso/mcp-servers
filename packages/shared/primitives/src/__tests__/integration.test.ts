/**
 * Step8 — primitives integration test.
 *
 * Exercises the composed op flow (container-gate → project → read →
 * redact → respond) end-to-end against ONE spec-faithful in-memory
 * backend that implements FieldWhitelist + ContainerAccess + the
 * reader traits + Redactor, wired through a single ToolContext. No
 * docker; the backend double honours the MUST rules in
 * docs/specs/whitelist-abstraction.md §"Behaviour rules".
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as api from "../index.js";
import {
  createFindByPkOp, createFindByEqOp, createContainerReadOp, createEnumerateOp,
  defaultClamp,
  type FieldWhitelist, type ContainerAccess, type FieldVisibility, type FieldPolicy,
  type PointReader, type EqReader, type Enumerator, type EnumeratePage, type Redactor,
  type GuardedRedactSet, type ToolContext,
} from "../index.js";

type Row = Record<string, unknown>;
const REDACTED = "[REDACTED]";

// --- Spec-faithful backend: one object implementing every trait the ops use. ---
const fieldCfg: Record<string, Record<string, { select?: FieldVisibility }>> = {
  users: {
    id: { select: "expose" },
    name: { select: "expose" },
    email: { select: "redact" },
    note: {}, // no explicit select → defaults to "redact" (spec §Field policy)
    pw: { select: "exclude" },
  },
};
const accessCfg: Record<string, string[]> = { bucket: ["ok/"] }; // allowed key prefixes
const store: Record<string, Row> = {
  "users:1": { id: 1, name: "ada", email: "ada@x.io", note: "vip", pw: "secret", internal: "leak" },
  "bucket:ok/report.txt": { body: "hello", meta: "m" },
};

function makeBackend() {
  const isField = (c: string) => Object.prototype.hasOwnProperty.call(fieldCfg, c);
  const isAccess = (c: string) => Object.prototype.hasOwnProperty.call(accessCfg, c);
  const has = (n: string): n is string => isField(n) || isAccess(n);
  const policyOf = (container: string, field: string): FieldVisibility => {
    if (!has(container)) return "exclude"; // spec: not-whitelisted → exclude
    const f = fieldCfg[container]?.[field];
    if (f === undefined) return "exclude"; // undeclared field → excluded (secure default)
    return f.select ?? "redact"; // declared, no select → redact
  };
  const selectable = (c: string) => Object.keys(fieldCfg[c] ?? {}).filter((f) => policyOf(c, f) !== "exclude");
  const redactSetOf = (c: string) => new Set(selectable(c).filter((f) => policyOf(c, f) === "redact"));
  const project = (rec: Row, fields: readonly string[]): Row => {
    if (fields.length === 0) return { ...rec }; // opaque payload (container_read)
    const out: Row = {};
    for (const f of fields) if (f in rec) out[f] = rec[f];
    return out;
  };
  const maskWith = (rec: Row, set: ReadonlySet<string>): Row =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, set.has(k) ? REDACTED : v]));

  const whitelist: FieldWhitelist & ContainerAccess = {
    listContainers: () => [...new Set([...Object.keys(fieldCfg), ...Object.keys(accessCfg)])].sort(),
    hasContainer: has,
    getContainer: (n) => (isField(n)
      ? { fields: Object.fromEntries(Object.entries(fieldCfg[n]).map(([f, v]) => [f, { select: v.select ?? "redact" } as FieldPolicy])) }
      : undefined),
    getSelectableFields: selectable,
    getFieldPolicy: ({ container, field }) => policyOf(container, field),
    isEmpty: (c) => isField(c) && Object.keys(fieldCfg[c]).every((f) => policyOf(c, f) === "exclude"),
    isItemAllowed: ({ container, item }) => has(container) && !item.includes("..") && (accessCfg[container]?.some((p) => item.startsWith(p)) ?? false),
    getContainerLimits: () => undefined,
  };

  const reader: PointReader<string, string | number, Row> = {
    readOne: async ({ container, key, fields }) => {
      const rec = store[`${container}:${String(key)}`];
      return rec ? project(rec, fields) : null; // spec: missing key → null, never throw
    },
  };
  const eqReader: EqReader<string, Row> = {
    readByEq: async ({ container, field, value, fields, limit }) =>
      Object.entries(store)
        .filter(([k]) => k.startsWith(`${container}:`))
        .map(([, r]) => r)
        .filter((r) => r[field] === value)
        .slice(0, limit)
        .map((r) => project(r, fields)),
  };
  const enumerator: Enumerator<string, string> = {
    enumerate: async ({ container, filter, limit }): Promise<EnumeratePage<string>> => {
      const items = Object.keys(store)
        .filter((k) => k.startsWith(`${container}:`))
        .map((k) => k.slice(container.length + 1))
        .filter((k) => (filter.prefix ? k.startsWith(filter.prefix) : true))
        .slice(0, limit);
      return { items, meta: { isTruncated: false } };
    },
  };
  const redactor: Redactor<string, Row> = {
    redactOne: ({ container, record, redactFieldNames }) => maskWith(record, redactFieldNames ?? redactSetOf(container)),
    redactMany: ({ container, records, redactFieldNames }) => {
      const set = redactFieldNames ?? redactSetOf(container);
      return records.map((r) => maskWith(r, set));
    },
  };

  const limit = defaultClamp({ defaultLimit: 10, maxLimit: 25 });
  const ctx: ToolContext<FieldWhitelist & ContainerAccess, PointReader<string, string | number, Row>, {
    redactor: Redactor<string, Row>; eqReader: EqReader<string, Row>; enumerator: Enumerator<string, string>;
  }> = {
    whitelist, reader, limit,
    trait: (name) => (name === "redactor" ? redactor : name === "eqReader" ? eqReader : name === "enumerator" ? enumerator
      : (() => { throw new api.UnsupportedOperationError({ tool: "integration", trait: String(name) }); })()) as never,
  };
  return ctx;
}

type Tag = { kind: string; [k: string]: unknown };
const respondPk = {
  ok: ({ row }: { row: Row }) => ({ kind: "ok", row }),
  notFound: ({ container }: { container: string }) => ({ kind: "notFound", container }),
  notWhitelisted: ({ container, available }: { container: string; available: readonly string[] }) => ({ kind: "notWhitelisted", container, available }),
  emptyWhitelist: ({ container }: { container: string }) => ({ kind: "emptyWhitelist", container }),
};

describe("primitives integration — composed flow against a spec-faithful backend", () => {
  const ctx = makeBackend();

  it("find-by-pk: projects selectable, redacts redact-policy, excludes pw + undeclared + default-redacts note", async () => {
    const op = createFindByPkOp<{ table: string; id: number }, typeof ctx, Tag>({
      argsSchema: z.object({ table: z.string(), id: z.number() }),
      extractContainer: (a) => a.table, extractKey: (a) => a.id, respond: respondPk,
    });
    const r = await op.execute({ args: { table: "users", id: 1 }, ctx });
    expect(r.kind).toBe("ok");
    expect(r.row).toEqual({ id: 1, name: "ada", email: REDACTED, note: REDACTED });
    // pw (exclude) + internal (undeclared) never leave the backend; email + note redacted.
  });

  it("find-by-pk: gates refuse (not throw) for unknown container / missing key", async () => {
    const op = createFindByPkOp<{ table: string; id: number }, typeof ctx, Tag>({
      argsSchema: z.object({ table: z.string(), id: z.number() }),
      extractContainer: (a) => a.table, extractKey: (a) => a.id, respond: respondPk,
    });
    expect((await op.execute({ args: { table: "ghost", id: 1 }, ctx })).kind).toBe("notWhitelisted");
    expect((await op.execute({ args: { table: "users", id: 999 }, ctx })).kind).toBe("notFound");
  });

  it("find-by-eq: caller limit 999 is clamped to maxLimit (25) and rows are redacted", async () => {
    const op = createFindByEqOp<{ table: string; field: string; value: unknown; limit?: number }, typeof ctx, Tag>({
      argsSchema: z.object({ table: z.string(), field: z.string(), value: z.unknown(), limit: z.number().optional() }),
      extractContainer: (a) => a.table, extractField: (a) => a.field, extractValue: (a) => a.value, extractLimit: (a) => a.limit,
      respond: {
        ok: ({ rows, count }) => ({ kind: "ok", rows, count }),
        notFound: ({ container }) => ({ kind: "notFound", container }),
        notWhitelisted: ({ container }) => ({ kind: "notWhitelisted", container }),
        emptyWhitelist: ({ container }) => ({ kind: "emptyWhitelist", container }),
        fieldNotSelectable: ({ field }) => ({ kind: "fieldNotSelectable", field }),
      },
    });
    // predicate on a selectable field (id, expose)
    const r = await op.execute({ args: { table: "users", field: "id", value: 1, limit: 999 }, ctx });
    expect(r.kind).toBe("ok");
    expect((r.rows as Row[])[0]).toEqual({ id: 1, name: "ada", email: REDACTED, note: REDACTED });
    // excluded predicate field is refused
    expect((await op.execute({ args: { table: "users", field: "pw", value: "x" }, ctx })).kind).toBe("fieldNotSelectable");
  });

  it("container-read: item ACL rejects path-traversal, allows a whitelisted-prefix key (opaque payload)", async () => {
    const op = createContainerReadOp<{ container: string; key: string }, typeof ctx, Tag, Row, string>({
      argsSchema: z.object({ container: z.string(), key: z.string() }),
      extractContainer: (a) => a.container, extractKey: (a) => a.key,
      respond: {
        ok: ({ record }) => ({ kind: "ok", record }),
        notFound: ({ key }) => ({ kind: "notFound", key }),
        notWhitelisted: ({ container }) => ({ kind: "notWhitelisted", container }),
        itemNotAllowed: ({ key }) => ({ kind: "itemNotAllowed", key }),
      },
    });
    expect((await op.execute({ args: { container: "bucket", key: "ok/../etc" }, ctx })).kind).toBe("itemNotAllowed");
    expect((await op.execute({ args: { container: "bucket", key: "denied/x" }, ctx })).kind).toBe("itemNotAllowed");
    const ok = await op.execute({ args: { container: "bucket", key: "ok/report.txt" }, ctx });
    expect(ok).toEqual({ kind: "ok", record: { body: "hello", meta: "m" } }); // opaque, no field projection
  });

  it("enumerate: lists prefix-filtered identifiers within a whitelisted container", async () => {
    const op = createEnumerateOp<{ container: string; prefix?: string }, typeof ctx, Tag, string>({
      argsSchema: z.object({ container: z.string(), prefix: z.string().optional() }),
      extractContainer: (a) => a.container, extractFilter: (a) => ({ prefix: a.prefix }),
      respond: {
        ok: ({ items, itemCount, meta }) => ({ kind: "ok", items, itemCount, meta }),
        notWhitelisted: ({ container }) => ({ kind: "notWhitelisted", container }),
      },
    });
    const r = await op.execute({ args: { container: "bucket", prefix: "ok/" }, ctx });
    expect(r.kind).toBe("ok");
    expect(r.items).toEqual(["ok/report.txt"]);
    expect(r.itemCount).toBe(1);
  });

  it("guard→redact brand: a GuardedRedactSet overrides per-container derivation", () => {
    const set: GuardedRedactSet = api.asGuardedRedactSet(new Set(["name"]));
    const redacted = makeBackend().trait("redactor").redactMany({ container: "users", records: [{ id: 1, name: "ada", email: "e" }], redactFieldNames: set });
    expect(redacted[0]).toEqual({ id: 1, name: REDACTED, email: "e" }); // uses override set, not the whitelist default
  });
});

describe("primitives public API — index.ts exports the full surface", () => {
  it("exposes errors, helpers, guard brand, and all op factories", () => {
    // errors
    expect(typeof api.UnsupportedOperationError).toBe("function");
    // guard brand helper
    expect(typeof api.asGuardedRedactSet).toBe("function");
    // helpers
    for (const h of ["defaultClamp", "mergeWhitelistAcrossContainers", "createStandardRespond"]) {
      expect(typeof (api as Record<string, unknown>)[h]).toBe("function");
    }
    // all 10 op factories
    for (const f of [
      "createFindByPkOp", "createFindByEqOp", "createFindByRangeOp", "createSearchOp",
      "createMultiSearchOp", "createContainerReadOp", "createEnumerateOp",
      "createInspectionOp", "createExplainOp", "createJsonSearchOp",
    ]) {
      expect(typeof (api as Record<string, unknown>)[f]).toBe("function");
    }
  });

  it("UnsupportedOperationError carries tool + trait", () => {
    const e = new api.UnsupportedOperationError({ tool: "t", trait: "Redactor" });
    expect(e).toBeInstanceOf(Error);
    expect(e.tool).toBe("t");
    expect(e.trait).toBe("Redactor");
  });
});
