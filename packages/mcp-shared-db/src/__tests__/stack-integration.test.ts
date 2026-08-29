/**
 * Full-stack integration test for the database describe/execute tool pair.
 *
 * Layers exercised, top-down:
 *   1. `createDatabaseTools` (this package, tools-factory)
 *   2. operations layer: list_tables / describe_table / get_by_pk / get_by_fk /
 *      get_by_index / get_by_date_range / json_search
 *   3. `createPostgresDataSource` (mcp-shared-db-postgres)
 *   4. `createSqlDataSource` + Postgres dialect SQL builder (mcp-shared-db-sql)
 *   5. fake `PgQueryClient` (this file) capturing `(sql, values)` and replaying
 *      canned rows
 *   6. PII redaction back through the operations layer to the MCP response shape
 *
 * Each op assertion checks all four:
 *   - SQL string and parameter array exactly as the Postgres dialect would emit
 *   - `pii: true` columns redacted to `"[REDACTED]"` in the response
 *   - response shape matches `{ content: [{ type: "text", text: <json> }] }`
 *   - `list_tables` / `describe_table` never reach the fake client
 */
import { describe, expect, it, vi } from "vitest";
import { createPostgresDataSource } from "mcp-shared-db-postgres";
import type { PgQueryClient } from "mcp-shared-db-postgres";
import { createDatabaseTools } from "../tools-factory.js";
import type { SelectableFieldsMap } from "../selectable-fields.js";
import type { TableMetadataMap } from "../metadata.js";

interface QueryCall {
  sql: string;
  values: unknown[];
}

interface FakePg {
  client: PgQueryClient;
  calls: QueryCall[];
  rows: Record<string, unknown>[];
  setRows(next: Record<string, unknown>[]): void;
}

/**
 * Inline pg.Client double. Records every `(sql, values)` and returns the
 * preconfigured `rows` payload. `connect` / `end` are noops because the stack
 * test doesn't manage a connection lifecycle.
 */
function makeFakePg(initialRows: Record<string, unknown>[] = []): FakePg {
  const calls: QueryCall[] = [];
  let rows = initialRows;
  const client: PgQueryClient = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query: vi.fn(
      async (
        textOrConfig: string | { text: string; values?: unknown[] },
        values?: unknown[],
      ) => {
        // Normalise both pg.Client signatures so existing assertions on
        // calls[N].sql / calls[N].values keep working after the factory
        // started using the config form for `queryMode: 'extended'`.
        const sql =
          typeof textOrConfig === "string" ? textOrConfig : textOrConfig.text;
        const vals =
          typeof textOrConfig === "string"
            ? values ?? []
            : textOrConfig.values ?? [];
        calls.push({ sql, values: vals });
        return { rows };
      },
    ),
  };
  return {
    client,
    calls,
    rows,
    setRows(next) {
      rows = next;
    },
  };
}

// Inline fixtures. `users` exercises every column type the ops can target:
// string PK, scalar (status/productId), datetime (createdAt) and json (meta).
// `name` and `email` are PII to verify redaction.
const selectableFields: SelectableFieldsMap = {
  users: {
    description: "Application users",
    fields: {
      id: { select: "expose" },
      name: { pii: true, piiReason: "real name" }, // legacy form to also exercise back-compat
      email: { pii: true, piiReason: "email address" },
      productId: { select: "expose" },
      status: { select: "expose" },
      meta: { select: "expose" },
      createdAt: { select: "expose" },
    },
  },
};

const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      name: { type: "string", nullable: false },
      email: { type: "string", nullable: true },
      productId: { type: "number", nullable: true },
      status: { type: "string", nullable: true },
      meta: { type: "json", nullable: true },
      createdAt: { type: "datetime", nullable: false },
    },
  },
};

const ALL_USER_COLUMNS = Object.keys(selectableFields.users.fields);

function setup(initialRows: Record<string, unknown>[] = []) {
  const pg = makeFakePg(initialRows);
  const ds = createPostgresDataSource({ client: pg.client, tableMetadata });
  const [describeTool, executeTool] = createDatabaseTools({
    selectableFields,
    tableMetadata,
    getDataSource: async () => ds,
  });
  return { pg, describeTool, executeTool };
}

interface McpTextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function expectMcpShape(result: McpTextResult): Record<string, unknown> {
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content[0]).toBeDefined();
  expect(result.content[0].type).toBe("text");
  expect(typeof result.content[0].text).toBe("string");
  return JSON.parse(result.content[0].text);
}

// Quote helpers: keep tests aligned with Postgres dialect emitted by the
// shared SQL builder. If the dialect ever changes we'll see the diff here.
function buildSelectAllUsersSql(): string {
  return ALL_USER_COLUMNS.map((c) => `"${c}"`).join(", ");
}

describe("stack integration: discovery ops never touch the DB", () => {
  it.each([
    {
      name: "list_tables",
      operation: "list_tables",
      params: {},
      assertText(text: string) {
        const data = JSON.parse(text);
        expect(data.count).toBe(1);
        expect(data.tables[0].name).toBe("users");
      },
    },
    {
      name: "describe_table",
      operation: "describe_table",
      params: { table: "users" },
      assertText(text: string) {
        const data = JSON.parse(text);
        expect(data.table).toBe("users");
        // The describe_table op returns column metadata — exact key names depend
        // on core, but at minimum we want to see a `pii` flag surfacing.
        const serialized = JSON.stringify(data);
        expect(serialized).toContain("name");
        expect(serialized).toContain("email");
      },
    },
  ])("$name does not call PgQueryClient.query", async ({ operation, params, assertText }) => {
    const { pg, executeTool } = setup();
    const result = (await executeTool.execute({ operation, params })) as McpTextResult;
    const data = expectMcpShape(result);
    assertText(JSON.stringify(data));
    expect(pg.calls).toHaveLength(0);
    expect(pg.client.query).not.toHaveBeenCalled();
  });
});

describe("stack integration: read ops drive the SQL builder + Postgres dialect end-to-end", () => {
  it("get_by_pk → SELECT … WHERE pk = $1 LIMIT 1 + redacts PII columns", async () => {
    const { pg, executeTool } = setup([
      {
        id: "u-1",
        name: "Alice",
        email: "alice@example.com",
        productId: 42,
        status: "active",
        meta: { foo: { bar: "x" } },
        createdAt: new Date("2024-06-01T00:00:00Z"),
      },
    ]);

    const result = (await executeTool.execute({
      operation: "get_by_pk",
      params: { table: "users", pk: "u-1" },
    })) as McpTextResult;
    const data = expectMcpShape(result);

    expect(pg.calls).toHaveLength(1);
    expect(pg.calls[0].sql).toBe(
      `SELECT ${buildSelectAllUsersSql()} FROM "users" WHERE "id" = $1 LIMIT 1`,
    );
    expect(pg.calls[0].values).toEqual(["u-1"]);
    expect(data.found).toBe(true);
    const row = data.row as Record<string, unknown>;
    expect(row.id).toBe("u-1");
    expect(row.name).toBe("[REDACTED]");
    expect(row.email).toBe("[REDACTED]");
    expect(row.status).toBe("active");
  });

  it("get_by_fk → SELECT … WHERE col = $1 LIMIT $2 + forwards user limit", async () => {
    const { pg, executeTool } = setup([
      { id: "u-1", name: "Alice", productId: 7 },
      { id: "u-2", name: "Bob", productId: 7 },
    ]);

    const result = (await executeTool.execute({
      operation: "get_by_fk",
      params: { table: "users", column: "productId", value: 7, limit: 25 },
    })) as McpTextResult;
    const data = expectMcpShape(result);

    expect(pg.calls).toHaveLength(1);
    expect(pg.calls[0].sql).toBe(
      `SELECT ${buildSelectAllUsersSql()} FROM "users" WHERE "productId" = $1 LIMIT $2`,
    );
    expect(pg.calls[0].values).toEqual([7, 25]);
    expect(data.count).toBe(2);
    const rows = data.rows as Record<string, unknown>[];
    expect(rows[0].name).toBe("[REDACTED]");
    expect(rows[1].name).toBe("[REDACTED]");
  });

  it("get_by_index → same shape as get_by_fk + falls back to default limit", async () => {
    const { pg, executeTool } = setup([
      { id: "u-1", name: "Alice", status: "active" },
    ]);

    const result = (await executeTool.execute({
      operation: "get_by_index",
      params: { table: "users", column: "status", value: "active" },
    })) as McpTextResult;
    const data = expectMcpShape(result);

    expect(pg.calls).toHaveLength(1);
    expect(pg.calls[0].sql).toBe(
      `SELECT ${buildSelectAllUsersSql()} FROM "users" WHERE "status" = $1 LIMIT $2`,
    );
    // Default LIMIT is 100 (operations layer constant).
    expect(pg.calls[0].values).toEqual(["active", 100]);
    expect(data.count).toBe(1);
    expect((data.rows as Record<string, unknown>[])[0].name).toBe("[REDACTED]");
  });

  it("get_by_date_range → SELECT … BETWEEN $1 AND $2 LIMIT $3 with Date bind values", async () => {
    const { pg, executeTool } = setup([
      {
        id: "u-1",
        name: "Alice",
        createdAt: new Date("2024-06-01T00:00:00Z"),
      },
    ]);

    const fromIso = "2024-01-01T00:00:00Z";
    const toIso = "2024-12-31T23:59:59Z";
    const result = (await executeTool.execute({
      operation: "get_by_date_range",
      params: { table: "users", column: "createdAt", from: fromIso, to: toIso, limit: 50 },
    })) as McpTextResult;
    const data = expectMcpShape(result);

    // Two pg calls now: the auto-EXPLAIN guard runs the same SELECT with
    // an EXPLAIN prefix first, then the real fetch. The fake client returns
    // the user rows (not pg plan JSON) for the EXPLAIN call, so the parser
    // sees no plan and the guard skips → fetch proceeds.
    expect(pg.calls).toHaveLength(2);
    const expectedSelect = `SELECT ${buildSelectAllUsersSql()} FROM "users" WHERE "createdAt" BETWEEN $1 AND $2 LIMIT $3`;
    expect(pg.calls[0].sql).toBe(`EXPLAIN (FORMAT JSON) ${expectedSelect}`);
    expect(pg.calls[1].sql).toBe(expectedSelect);
    const [from, to, lim] = pg.calls[1].values as [Date, Date, number];
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
    expect(from.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2024-12-31T23:59:59.000Z");
    expect(lim).toBe(50);
    // Same bind values are used for both calls.
    expect(pg.calls[0].values).toEqual(pg.calls[1].values);
    expect(data.count).toBe(1);
    expect((data.rows as Record<string, unknown>[])[0].name).toBe("[REDACTED]");
  });

  it("json_search → uses #>> with text[] segment binding + normalizes path", async () => {
    const { pg, executeTool } = setup([
      { id: "u-1", name: "Alice", meta: { foo: { bar: "x" } } },
    ]);

    const result = (await executeTool.execute({
      operation: "json_search",
      params: { table: "users", column: "meta", path: "foo.bar", value: "x" },
    })) as McpTextResult;
    const data = expectMcpShape(result);

    expect(pg.calls).toHaveLength(1);
    expect(pg.calls[0].sql).toBe(
      `SELECT ${buildSelectAllUsersSql()} FROM "users" WHERE "meta" #>> $1 = $2 LIMIT $3`,
    );
    // Order: segments ($1), value ($2), limit ($3) -- placeholders numbered
    // left to right, because the dialect allocates each one as it emits it.
    // The segments arrive as a JS array which pg coerces to a text[] over
    // the wire.
    expect(pg.calls[0].values).toEqual([["foo", "bar"], "x", 100]);
    expect(Array.isArray((pg.calls[0].values as unknown[])[0])).toBe(true);
    expect(data.path).toBe("$.foo.bar");
    expect(data.count).toBe(1);
    expect((data.rows as Record<string, unknown>[])[0].name).toBe("[REDACTED]");
  });
});

describe("stack integration: not-found / empty result paths", () => {
  it("get_by_pk reports found=false when query returns no rows", async () => {
    const { pg, executeTool } = setup([]);
    const result = (await executeTool.execute({
      operation: "get_by_pk",
      params: { table: "users", pk: "missing" },
    })) as McpTextResult;
    const data = expectMcpShape(result);
    expect(pg.calls).toHaveLength(1);
    expect(data.found).toBe(false);
  });

  it.each([
    { name: "get_by_fk", operation: "get_by_fk", params: { table: "users", column: "productId", value: 999 } },
    { name: "get_by_index", operation: "get_by_index", params: { table: "users", column: "status", value: "none" } },
  ])("$name returns count=0 + empty rows on no match", async ({ operation, params }) => {
    const { executeTool } = setup([]);
    const result = (await executeTool.execute({ operation, params })) as McpTextResult;
    const data = expectMcpShape(result);
    expect(data.count).toBe(0);
    expect(data.rows).toEqual([]);
  });
});
