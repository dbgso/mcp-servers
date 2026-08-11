/**
 * Tests for the RDB-specific operations using a FakeDataSource that records
 * each call and returns canned rows. Engine-specific concerns (SQL fragments,
 * placeholder ordering, JSON-path expressions) are out of scope here — they
 * belong to adapter packages (`mcp-shared-db-sql`, `mcp-shared-db-postgres`).
 */
import { afterEach, describe, it, expect } from "vitest";
import { getByPkOp } from "../operations/get-by-pk.js";
import { getByFkOp } from "../operations/get-by-fk.js";
import { getByIndexOp } from "../operations/get-by-index.js";
import {
  DEFAULT_MAX_ESTIMATED_ROWS,
  getByDateRangeOp,
} from "../operations/get-by-date-range.js";
import { jsonSearchOp } from "../operations/json-search.js";
import { explainSqlOp } from "../operations/explain-sql.js";
import type { DatabaseOperation, DatabaseOperationContext } from "../operations/types.js";
import type { TableMetadataMap } from "../metadata.js";
import type { SelectableFieldsMap } from "mcp-shared-db-core";
import {
  createFakeDataSource,
  type FakeDataSourceHandle,
  type FakeDataSourceReturns,
} from "./fixtures/fake-data-source.js";

// Inline test fixtures (no Drizzle dependency now that the operation layer
// is engine-agnostic). The shape mirrors what a hand-written
// selectable-fields.ts / metadata.ts would look like.

const selectableFields: SelectableFieldsMap = {
  users: {
    description: "Application users",
    fields: {
      id: { select: "expose" },
      name: { pii: true, piiReason: "real name" },
      email: { pii: true, piiReason: "PII" },
      productId: { select: "expose" },
      status: { select: "expose" },
      meta: { select: "expose" },
      isAdmin: { select: "expose" },
      createdAt: { select: "expose" },
    },
  },
  products: {
    fields: {
      id: { select: "expose" },
      ownerId: { select: "expose" },
      name: { select: "expose" },
    },
  },
  noPkTable: {
    fields: { value: { select: "expose" } },
  },
};

const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "number", nullable: false },
      name: { type: "string", nullable: false },
      email: { type: "string", nullable: true },
      productId: { type: "number", nullable: true },
      status: { type: "string", nullable: true },
      meta: { type: "json", nullable: true },
      isAdmin: { type: "boolean", nullable: true },
      createdAt: { type: "datetime", nullable: true },
    },
  },
  products: {
    tableName: "products",
    // Composite primary key — get_by_pk should reject these.
    primaryKey: ["id", "ownerId"],
    fields: {
      id: { type: "number", nullable: false },
      ownerId: { type: "number", nullable: false },
      name: { type: "string", nullable: true },
    },
  },
  noPkTable: {
    tableName: "no_pk_table",
    primaryKey: [],
    fields: { value: { type: "string", nullable: true } },
  },
};

interface BuiltCtx {
  ctx: DatabaseOperationContext;
  fake: FakeDataSourceHandle;
}

function buildCtx(returns: FakeDataSourceReturns = {}): BuiltCtx {
  const fake = createFakeDataSource(returns);
  return {
    fake,
    ctx: { dataSource: fake.dataSource, selectableFields, tableMetadata },
  };
}

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

interface OpCase {
  name: string;
  op: DatabaseOperation<Record<string, unknown>>;
  /** Valid args that hit the happy path on the fixtures. */
  args: Record<string, unknown>;
  /** Op takes a `column` arg (false only for get_by_pk). */
  hasColumnArg: boolean;
  /** A column on `users` whose Layer-1 type is NOT what this op requires. */
  typeMismatchColumn?: string;
  /** The Layer-1 type the op enforces (datetime / json). */
  requiredColumnType?: "datetime" | "json";
}

const allOpCases: OpCase[] = [
  {
    name: "get_by_pk",
    op: getByPkOp as DatabaseOperation<Record<string, unknown>>,
    args: { table: "users", pk: 1 },
    hasColumnArg: false,
  },
  {
    name: "get_by_fk",
    op: getByFkOp as DatabaseOperation<Record<string, unknown>>,
    args: { table: "users", column: "productId", value: 7 },
    hasColumnArg: true,
  },
  {
    name: "get_by_index",
    op: getByIndexOp as DatabaseOperation<Record<string, unknown>>,
    args: { table: "users", column: "status", value: "active" },
    hasColumnArg: true,
  },
  {
    name: "get_by_date_range",
    op: getByDateRangeOp as DatabaseOperation<Record<string, unknown>>,
    args: {
      table: "users",
      column: "createdAt",
      from: "2026-01-01T00:00:00Z",
      to: "2026-12-31T23:59:59Z",
    },
    hasColumnArg: true,
    typeMismatchColumn: "status",
    requiredColumnType: "datetime",
  },
  {
    name: "json_search",
    op: jsonSearchOp as DatabaseOperation<Record<string, unknown>>,
    args: { table: "users", column: "meta", path: "foo.bar", value: "x" },
    hasColumnArg: true,
    typeMismatchColumn: "status",
    requiredColumnType: "json",
  },
];

const columnTargetingCases = allOpCases.filter((c) => c.hasColumnArg);
const typeCheckingCases = allOpCases.filter(
  (c): c is OpCase & { typeMismatchColumn: string; requiredColumnType: "datetime" | "json" } =>
    c.typeMismatchColumn !== undefined && c.requiredColumnType !== undefined,
);

// Common error paths shared by every op.

describe.each(allOpCases)("$name: common error paths", ({ op, args }) => {
  it("rejects unknown table", async () => {
    const { ctx } = buildCtx();
    const result = await op.execute({ args: { ...args, table: "missing" }, ctx });
    const data = parse(result);
    expect(data.error).toContain("not selectable");
    expect(data.availableTables).toContain("users");
  });
});

// Common error paths for ops that take a `column` arg.

describe.each(columnTargetingCases)("$name: column-arg error paths", ({ op, args }) => {
  it("rejects column not in selectable-fields whitelist", async () => {
    const { ctx } = buildCtx();
    const result = await op.execute({ args: { ...args, column: "ssn" }, ctx });
    expect(parse(result).error).toContain("not selectable");
  });
});

// Type-check error paths (date_range / json_search).

describe.each(typeCheckingCases)(
  "$name: Layer-1 type guards",
  ({ op, args, typeMismatchColumn, requiredColumnType }) => {
    it("rejects column whose Layer-1 type doesn't match", async () => {
      const { ctx } = buildCtx();
      const result = await op.execute({ args: { ...args, column: typeMismatchColumn }, ctx });
      const expectedFragment =
        requiredColumnType === "datetime" ? "not a datetime column" : "not a JSON column";
      expect(parse(result).error).toContain(expectedFragment);
    });

    it("rejects column missing from Layer-1 metadata", async () => {
      const { ctx } = buildCtx();
      // Add a whitelist entry that has no Layer-1 metadata counterpart.
      ctx.selectableFields = {
        ...selectableFields,
        users: {
          ...selectableFields.users,
          fields: { ...selectableFields.users.fields, ghostNoMeta: { select: "expose" } },
        },
      };
      const result = await op.execute({ args: { ...args, column: "ghostNoMeta" }, ctx });
      expect(parse(result).error).toContain("no metadata");
    });
  },
);

// Op-specific behavior.

describe("get_by_pk: behavior unique to single-PK lookup", () => {
  it("returns the redacted row when found", async () => {
    const { ctx, fake } = buildCtx({
      findByPk: { id: 1, name: "Alice", email: "a@x.com", productId: 2, status: "active" },
    });
    const result = await getByPkOp.execute({ args: { table: "users", pk: 1 }, ctx });
    const data = parse(result);
    expect(data.found).toBe(true);
    const row = data.row as Record<string, unknown>;
    expect(row.id).toBe(1);
    expect(row.name).toBe("[REDACTED]");
    expect(row.email).toBe("[REDACTED]");
    expect(row.status).toBe("active");
    // DataSource invocation shape.
    expect(fake.findByPk).toHaveBeenCalledWith({
      table: "users",
      pk: 1,
      columns: Object.keys(selectableFields.users.fields),
    });
  });

  it("reports found=false when no rows match", async () => {
    const { ctx } = buildCtx({ findByPk: null });
    const result = await getByPkOp.execute({ args: { table: "users", pk: 999 }, ctx });
    expect(parse(result).found).toBe(false);
  });

  it.each([
    { desc: "composite PK", table: "products", expected: "composite primary key" },
    { desc: "no PK", table: "noPkTable", expected: "no primary key" },
  ])("rejects table with $desc", async ({ table, expected }) => {
    const { ctx } = buildCtx();
    const result = await getByPkOp.execute({ args: { table, pk: 1 }, ctx });
    expect(parse(result).error).toContain(expected);
  });
});

describe("get_by_fk / get_by_index: shared happy-path shape", () => {
  it.each([
    {
      name: "get_by_fk",
      op: getByFkOp,
      args: { table: "users", column: "productId", value: 7 },
      rowsReturn: [
        { id: 1, name: "Alice", productId: 7 },
        { id: 2, name: "Bob", productId: 7 },
      ],
      expectedCount: 2,
    },
    {
      name: "get_by_index",
      op: getByIndexOp,
      args: { table: "users", column: "status", value: "active" },
      rowsReturn: [{ id: 1, name: "Alice", status: "active" }],
      expectedCount: 1,
    },
  ])("$name returns redacted rows for matching value", async ({ op, args, rowsReturn, expectedCount }) => {
    const { ctx, fake } = buildCtx({ findByEq: rowsReturn });
    const result = await op.execute({ args, ctx });
    const data = parse(result);
    expect(data.count).toBe(expectedCount);
    const returned = data.rows as Record<string, unknown>[];
    expect(returned[0].name).toBe("[REDACTED]");
    expect(fake.findByEq).toHaveBeenCalledWith(
      expect.objectContaining({
        table: args.table,
        field: args.column,
        value: args.value,
      }),
    );
  });
});

describe("get_by_fk: limit forwarding", () => {
  it("forwards the user-supplied limit to DataSource.findByEq", async () => {
    const { ctx, fake } = buildCtx({ findByEq: [{ id: 1 }] });
    await getByFkOp.execute({
      args: { table: "users", column: "productId", value: 7, limit: 5 },
      ctx,
    });
    expect(fake.findByEq).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it("falls back to the default limit when omitted", async () => {
    const { ctx, fake } = buildCtx({ findByEq: [] });
    await getByFkOp.execute({
      args: { table: "users", column: "productId", value: 7 },
      ctx,
    });
    expect(fake.findByEq).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });
});

describe("get_by_date_range: happy path + range validation", () => {
  const validArgs = {
    table: "users",
    column: "createdAt",
    from: "2026-01-01T00:00:00Z",
    to: "2026-12-31T23:59:59Z",
  };

  it("returns redacted rows for a valid range and forwards Date bounds", async () => {
    const { ctx, fake } = buildCtx({
      findByRange: [{ id: 1, name: "Alice", createdAt: "2026-06-01T00:00:00Z" }],
    });
    const result = await getByDateRangeOp.execute({ args: validArgs, ctx });
    const data = parse(result);
    expect(data.count).toBe(1);
    const rows = data.rows as Record<string, unknown>[];
    expect(rows[0].name).toBe("[REDACTED]");

    const call = fake.findByRange.mock.calls[0][0] as {
      table: string;
      field: string;
      from: Date;
      to: Date;
    };
    expect(call.table).toBe("users");
    expect(call.field).toBe("createdAt");
    expect(call.from).toBeInstanceOf(Date);
    expect(call.to).toBeInstanceOf(Date);
    expect(call.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each([
    {
      desc: "invalid 'from'",
      args: { ...validArgs, from: "not-a-date" },
      expected: "Invalid 'from' or 'to'",
    },
    {
      desc: "invalid 'to'",
      args: { ...validArgs, to: "not-a-date" },
      expected: "Invalid 'from' or 'to'",
    },
    {
      desc: "from > to",
      args: { ...validArgs, from: "2027-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" },
      expected: "'from' must be <= 'to'",
    },
  ])("rejects $desc", async ({ args, expected }) => {
    const { ctx } = buildCtx();
    const result = await getByDateRangeOp.execute({ args, ctx });
    expect(parse(result).error).toContain(expected);
  });
});

describe("json_search: happy path + path normalization", () => {
  const baseArgs = { table: "users", column: "meta", value: "x" };

  it("returns redacted rows for a valid JSON column query", async () => {
    const { ctx, fake } = buildCtx({
      findByJsonPath: [{ id: 1, name: "Alice", meta: { foo: { bar: "x" } } }],
    });
    const result = await jsonSearchOp.execute({
      args: { ...baseArgs, path: "foo.bar" },
      ctx,
    });
    const data = parse(result);
    expect(data.count).toBe(1);
    const rows = data.rows as Record<string, unknown>[];
    expect(rows[0].name).toBe("[REDACTED]");
    expect(fake.findByJsonPath).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "users",
        field: "meta",
        path: "$.foo.bar",
        value: "x",
      }),
    );
  });

  it.each([
    { input: "foo.bar", expected: "$.foo.bar" },
    { input: "$.absolute.path", expected: "$.absolute.path" },
    { input: "$", expected: "$" },
  ])("normalizes path '$input' → '$expected'", async ({ input, expected }) => {
    const { ctx } = buildCtx({ findByJsonPath: [] });
    const result = await jsonSearchOp.execute({
      args: { ...baseArgs, path: input },
      ctx,
    });
    expect(parse(result).path).toBe(expected);
  });

  it.each([
    { label: "embedded single quote", path: "foo'); DROP TABLE x; --" },
    { label: "whitespace", path: "foo bar" },
    { label: "semicolon", path: "foo;DROP" },
    { label: "bracketed quoted key", path: "foo['bar']" },
    { label: "double quote", path: 'foo"bar' },
    { label: "comment marker", path: "foo--evil" },
    { label: "empty string", path: "" },
  ])(
    "rejects $label as a JSON path (op-layer injection guard)",
    ({ path }) => {
      // Defense-in-depth: even though dialects must bind the path,
      // op-layer rejects anything outside [\\w.[\\]$] so a single-line
      // dialect mistake doesn't open injection. Validate via Zod
      // safeParse — the op should never even get to dataSource.
      const parsed = jsonSearchOp.argsSchema.safeParse({
        ...baseArgs,
        path,
      });
      expect(parsed.success).toBe(false);
    },
  );

  it.each([
    "foo.bar",
    "$.absolute.path",
    "$",
    "$.items[0]",
    "$.deeply.nested[3].field",
    "snake_case_field",
  ])("accepts safe path '%s'", (path) => {
    const parsed = jsonSearchOp.argsSchema.safeParse({
      ...baseArgs,
      path,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("un-indexed column warning", () => {
  // Layered metadata: explicit `indexes` arrays let us assert both the
  // "indexed → silent" and "un-indexed → warning" branches.
  const indexedTableMetadata: TableMetadataMap = {
    users: {
      tableName: "users",
      primaryKey: ["id"],
      fields: {
        id: { type: "number", nullable: false },
        name: { type: "string", nullable: false },
        email: { type: "string", nullable: true },
        productId: { type: "number", nullable: true },
        status: { type: "string", nullable: true },
        meta: { type: "json", nullable: true },
        createdAt: { type: "datetime", nullable: true },
      },
      indexes: [
        { name: "users_status_idx", fields: ["status"], isUnique: false },
        { name: "users_createdAt_idx", fields: ["createdAt"], isUnique: false },
        { name: "users_meta_gin", fields: ["meta"], isUnique: false },
      ],
    },
    products: tableMetadata.products,
    noPkTable: tableMetadata.noPkTable,
  };

  function buildIndexedCtx(returns: FakeDataSourceReturns = {}): BuiltCtx {
    const fake = createFakeDataSource(returns);
    return {
      fake,
      ctx: {
        dataSource: fake.dataSource,
        selectableFields,
        tableMetadata: indexedTableMetadata,
      },
    };
  }

  it.each([
    {
      label: "get_by_index on an indexed column",
      op: getByIndexOp,
      args: { table: "users", column: "status", value: "active" },
      returns: { findByEq: [{ id: 1, status: "active" }] },
      expectWarning: false,
    },
    {
      label: "get_by_index on an un-indexed column",
      op: getByIndexOp,
      args: { table: "users", column: "email", value: "x@y.z" },
      returns: { findByEq: [] },
      expectWarning: true,
    },
    {
      label: "get_by_fk on an un-indexed FK column (PG does not auto-index)",
      op: getByFkOp,
      args: { table: "users", column: "productId", value: 7 },
      returns: { findByEq: [] },
      expectWarning: true,
    },
    {
      label: "get_by_date_range on an indexed datetime column",
      op: getByDateRangeOp,
      args: {
        table: "users",
        column: "createdAt",
        from: "2026-01-01T00:00:00Z",
        to: "2026-12-31T23:59:59Z",
      },
      returns: { findByRange: [] },
      expectWarning: false,
    },
    {
      label: "json_search on an indexed JSON column",
      op: jsonSearchOp,
      args: {
        table: "users",
        column: "meta",
        path: "$.foo",
        value: "x",
      },
      returns: { findByJsonPath: [] },
      expectWarning: false,
    },
  ])("$label", async ({ op, args, returns, expectWarning }) => {
    const { ctx } = buildIndexedCtx(returns);
    const result = await op.execute({
      args: args as Record<string, unknown>,
      ctx,
    });
    const data = parse(result);
    if (expectWarning) {
      expect(data.warning).toEqual(expect.any(String));
      expect(String(data.warning)).toContain(args.column);
    } else {
      expect(data.warning).toBeUndefined();
    }
  });

  it("is silent when metadata has no `indexes` field at all", async () => {
    // Default fixture above leaves `indexes` undefined.
    const { ctx } = buildCtx({ findByEq: [] });
    const result = await getByIndexOp.execute({
      args: { table: "users", column: "email", value: "x@y.z" },
      ctx,
    });
    expect(parse(result).warning).toBeUndefined();
  });
});

describe("get_by_date_range with auto-EXPLAIN guard", () => {
  const validArgs = {
    table: "users",
    column: "createdAt",
    from: "2026-01-01T00:00:00Z",
    to: "2026-12-31T23:59:59Z",
  };

  function safeExplain(rows = 50) {
    return {
      estimatedRows: rows,
      totalCost: 12.3,
      planSummary: "Index Scan using users_createdAt_idx on users",
      raw: { "Node Type": "Index Scan" },
    };
  }

  afterEach(() => {
    delete process.env.DBREAD_MAX_ESTIMATED_ROWS;
  });

  it("runs explainFindByRange first, then findByRange when under threshold", async () => {
    const { ctx, fake } = buildCtx({
      explainFindByRange: safeExplain(50),
      findByRange: [{ id: 1, name: "Alice", createdAt: "2026-06-01T00:00:00Z" }],
    });
    const result = await getByDateRangeOp.execute({ args: validArgs, ctx });
    const data = parse(result);
    expect(fake.explainFindByRange).toHaveBeenCalled();
    expect(fake.findByRange).toHaveBeenCalled();
    expect(data.estimatedRows).toBe(50);
    expect(data.planSummary).toContain("Index Scan");
    expect(data.count).toBe(1);
  });

  it("blocks the fetch when the estimate exceeds the default 100k threshold", async () => {
    const { ctx, fake } = buildCtx({
      explainFindByRange: safeExplain(200_000),
    });
    const result = await getByDateRangeOp.execute({ args: validArgs, ctx });
    const data = parse(result);
    expect(fake.findByRange).not.toHaveBeenCalled();
    expect(String(data.error)).toMatch(/exceeds the safety threshold/);
    expect(data.estimatedRows).toBe(200_000);
    expect(data.threshold).toBe(DEFAULT_MAX_ESTIMATED_ROWS);
    expect(data.planSummary).toContain("Index Scan");
  });

  it("lets the fetch through when confirmExpensive: true is supplied", async () => {
    const { ctx, fake } = buildCtx({
      explainFindByRange: safeExplain(200_000),
      findByRange: [],
    });
    await getByDateRangeOp.execute({
      args: { ...validArgs, confirmExpensive: true },
      ctx,
    });
    expect(fake.findByRange).toHaveBeenCalled();
  });

  it("skips the guard when the engine cannot surface an estimate (estimatedRows === null)", async () => {
    const { ctx, fake } = buildCtx({
      explainFindByRange: { ...safeExplain(0), estimatedRows: null },
      findByRange: [],
    });
    await getByDateRangeOp.execute({ args: validArgs, ctx });
    expect(fake.findByRange).toHaveBeenCalled();
  });

  it.each([
    { label: "unset", env: undefined, expected: DEFAULT_MAX_ESTIMATED_ROWS },
    { label: "explicit value", env: "10000", expected: 10_000 },
    { label: "empty string", env: "", expected: DEFAULT_MAX_ESTIMATED_ROWS },
    { label: "non-numeric", env: "abc", expected: DEFAULT_MAX_ESTIMATED_ROWS },
    { label: "zero", env: "0", expected: DEFAULT_MAX_ESTIMATED_ROWS },
    { label: "negative", env: "-5", expected: DEFAULT_MAX_ESTIMATED_ROWS },
  ])(
    "resolves DBREAD_MAX_ESTIMATED_ROWS=$label to $expected",
    async ({ env, expected }) => {
      if (env !== undefined) process.env.DBREAD_MAX_ESTIMATED_ROWS = env;
      const { ctx } = buildCtx({
        explainFindByRange: safeExplain(expected + 1),
      });
      const result = await getByDateRangeOp.execute({ args: validArgs, ctx });
      const data = parse(result);
      expect(data.threshold).toBe(expected);
      expect(String(data.error)).toMatch(/exceeds the safety threshold/);
    },
  );

  it("attaches the un-indexed warning to the BLOCKED response, not just the success path", async () => {
    // Stand-alone metadata with an explicit empty indexes[] and no leading
    // index on createdAt — the guard should block AND surface the warning
    // so the LLM has a concrete next step (different column / new index).
    const unindexedMeta: TableMetadataMap = {
      users: {
        tableName: "users",
        primaryKey: ["id"],
        fields: tableMetadata.users.fields,
        indexes: [], // explicitly empty — no leading index on any column
      },
      products: tableMetadata.products,
      noPkTable: tableMetadata.noPkTable,
    };
    const fake = createFakeDataSource({
      explainFindByRange: {
        estimatedRows: 200_000,
        totalCost: 9999,
        planSummary: "Seq Scan on users",
        raw: null,
      },
    });
    const ctx: DatabaseOperationContext = {
      dataSource: fake.dataSource,
      selectableFields,
      tableMetadata: unindexedMeta,
    };
    const result = await getByDateRangeOp.execute({ args: validArgs, ctx });
    const data = parse(result);
    expect(String(data.error)).toMatch(/exceeds the safety threshold/);
    expect(String(data.warning)).toContain("createdAt");
    expect(fake.findByRange).not.toHaveBeenCalled();
  });

  it.each([
    { label: "non-datetime column", overrides: { column: "name" } },
    {
      label: "from > to",
      overrides: { from: "2026-12-31T00:00:00Z", to: "2026-01-01T00:00:00Z" },
    },
    { label: "unparseable from", overrides: { from: "not-a-date" } },
    { label: "missing column", overrides: { column: "ghost" } },
  ])("does NOT call explainFindByRange when $label rejects up-front", async ({ overrides }) => {
    const { ctx, fake } = buildCtx();
    await getByDateRangeOp.execute({
      args: { ...validArgs, ...overrides },
      ctx,
    });
    expect(fake.explainFindByRange).not.toHaveBeenCalled();
    expect(fake.findByRange).not.toHaveBeenCalled();
  });
});

describe("explain_sql operation", () => {
  function safeExplain(rows = 100) {
    return {
      estimatedRows: rows,
      totalCost: 12.34,
      planSummary: "Seq Scan on widgets",
      raw: { "Node Type": "Seq Scan", "Plan Rows": rows },
    };
  }

  it("delegates to dataSource.explainSql with sql + params", async () => {
    const { ctx, fake } = buildCtx({ explainSql: safeExplain(7) });
    const result = await explainSqlOp.execute({
      args: { sql: "SELECT * FROM users WHERE id = $1", params: [42] },
      ctx,
    });
    const data = parse(result);
    expect(fake.explainSql).toHaveBeenCalledWith({
      sql: "SELECT * FROM users WHERE id = $1",
      params: [42],
    });
    expect(data.estimatedRows).toBe(7);
    expect(data.planSummary).toBe("Seq Scan on widgets");
  });

  it("forwards an empty params array when none given", async () => {
    const { ctx, fake } = buildCtx({ explainSql: safeExplain() });
    await explainSqlOp.execute({
      args: { sql: "SELECT 1" },
      ctx,
    });
    expect(fake.explainSql).toHaveBeenCalledWith({ sql: "SELECT 1", params: [] });
  });

  it.each([
    { label: "default", verbose: undefined, expectRaw: false },
    { label: "explicit false", verbose: false, expectRaw: false },
    { label: "explicit true", verbose: true, expectRaw: true },
  ])("verbose=$label controls whether `raw` is included", async ({ verbose, expectRaw }) => {
    const explain = safeExplain();
    const { ctx } = buildCtx({ explainSql: explain });
    const result = await explainSqlOp.execute({
      args: {
        sql: "SELECT 1",
        ...(verbose !== undefined && { verbose }),
      } as Record<string, unknown>,
      ctx,
    });
    const data = parse(result);
    if (expectRaw) {
      expect(data.raw).toEqual(explain.raw);
    } else {
      expect(data.raw).toBeUndefined();
    }
    // Compact fields are always present.
    expect(data.estimatedRows).toBe(explain.estimatedRows);
    expect(data.planSummary).toBe(explain.planSummary);
  });

  it("does NOT consult selectableFields or tableMetadata (whitelist bypass is intentional)", async () => {
    // The op layer wires `dataSource: fake.dataSource` plus selectableFields
    // / tableMetadata. The whitelist-bypass property is enforced by the op
    // simply not reading those — we assert that by passing SQL referring to
    // a table that isn't in either map and seeing it round-trip cleanly.
    const { ctx, fake } = buildCtx({ explainSql: safeExplain(99) });
    const sql = "SELECT * FROM secret_table WHERE x = 1";
    const result = await explainSqlOp.execute({ args: { sql }, ctx });
    expect(fake.explainSql).toHaveBeenCalledWith({ sql, params: [] });
    expect(parse(result).estimatedRows).toBe(99);
  });

  it.each([
    { label: "empty string", sql: "" },
    { label: "type mismatch (number)", sql: 123 },
    { label: "missing", sql: undefined },
  ])("rejects $label for sql arg", async ({ sql }) => {
    const { ctx, fake } = buildCtx();
    // The op uses Zod for arg validation — empty / missing / wrong-type
    // should never reach the dataSource. We invoke through `safeParse` to
    // surface the validation error path here.
    const parsed = explainSqlOp.argsSchema.safeParse({ sql });
    if (parsed.success) {
      // Unexpected — keep the test honest.
      throw new Error(`Expected zod to reject sql=${JSON.stringify(sql)}`);
    }
    expect(fake.explainSql).not.toHaveBeenCalled();
  });

  it("propagates an engine error (e.g. SQL syntax error) through to the response", async () => {
    const { ctx } = buildCtx();
    const fake = createFakeDataSource();
    fake.explainSql.mockRejectedValue(new Error("syntax error at or near 'EXPLAIN'"));
    const local = { ...ctx, dataSource: fake.dataSource };
    await expect(
      explainSqlOp.execute({ args: { sql: "EXPLAIN BOOM" }, ctx: local }),
    ).rejects.toThrow(/syntax error/);
  });
});
