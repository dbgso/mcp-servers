import { describe, expect, it, vi } from "vitest";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { createSqlDataSource, type QueryFn } from "../data-source.js";
import { pgFakeDialect } from "./fixtures.js";

const tableMetadata: RdbTableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      meta: { type: "json", nullable: true },
      createdAt: { type: "datetime", nullable: false },
    },
  },
  composite_pk: {
    tableName: "composite_pk",
    primaryKey: ["a", "b"],
    fields: {
      a: { type: "string", nullable: false },
      b: { type: "string", nullable: false },
    },
  },
};

function makeQueryFn(rows: Record<string, unknown>[]): QueryFn {
  return vi.fn(async () => ({ rows }));
}

describe("createSqlDataSource", () => {
  it("findByPk runs the built SQL and unwraps the first row", async () => {
    const query = makeQueryFn([{ id: "u1", meta: null, createdAt: null }]);
    const ds = createSqlDataSource({ query, dialect: pgFakeDialect, tableMetadata });

    const row = await ds.findByPk({ table: "users", pk: "u1", columns: ["id", "meta"] });
    expect(row).toEqual({ id: "u1", meta: null, createdAt: null });
    expect(query).toHaveBeenCalledWith({
      sql: 'SELECT "id", "meta" FROM "users" WHERE "id" = $1 LIMIT 1',
      values: ["u1"],
    });
  });

  it("findByPk returns null when no row matches", async () => {
    const ds = createSqlDataSource({
      query: makeQueryFn([]),
      dialect: pgFakeDialect,
      tableMetadata,
    });
    const row = await ds.findByPk({ table: "users", pk: "u1", columns: ["id"] });
    expect(row).toBeNull();
  });

  it("findByEq forwards rows", async () => {
    const rows = [{ id: "u1" }, { id: "u2" }];
    const ds = createSqlDataSource({
      query: makeQueryFn(rows),
      dialect: pgFakeDialect,
      tableMetadata,
    });
    const out = await ds.findByEq({
      table: "users",
      field: "id",
      value: "x",
      columns: ["id"],
      limit: 100,
    });
    expect(out).toEqual(rows);
  });

  it("findByRange forwards rows", async () => {
    const rows = [{ id: "u1" }];
    const query = makeQueryFn(rows);
    const ds = createSqlDataSource({ query, dialect: pgFakeDialect, tableMetadata });
    const from = new Date("2026-01-01");
    const to = new Date("2026-02-01");
    const out = await ds.findByRange({
      table: "users",
      field: "createdAt",
      from,
      to,
      columns: ["id"],
      limit: 50,
    });
    expect(out).toEqual(rows);
    expect(query).toHaveBeenCalledWith({
      sql: expect.stringContaining("BETWEEN"),
      values: [from, to, 50],
    });
  });

  it("explainFindByRange wraps the same SELECT with the dialect's EXPLAIN prefix", async () => {
    // The pg fake dialect returns "EXPLAIN (FORMAT JSON)" + a parser that
    // pulls Plan Rows / Total Cost out of pg's standard plan shape.
    const planRow = {
      "QUERY PLAN": [
        {
          Plan: { "Node Type": "Index Scan", "Plan Rows": 7, "Total Cost": 12.34 },
        },
      ],
    };
    const query = makeQueryFn([planRow]);
    const ds = createSqlDataSource({ query, dialect: pgFakeDialect, tableMetadata });
    const from = new Date("2026-01-01");
    const to = new Date("2026-02-01");

    const explain = await ds.explainFindByRange({
      table: "users",
      field: "createdAt",
      from,
      to,
      columns: ["id"],
      limit: 50,
    });

    // Same bound values + LIMIT as findByRange would have used.
    const args = (query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      sql: string;
      values: unknown[];
    };
    expect(args.sql.startsWith("EXPLAIN (FORMAT JSON) ")).toBe(true);
    expect(args.sql).toContain("BETWEEN");
    expect(args.values).toEqual([from, to, 50]);
    expect(explain.estimatedRows).toBe(7);
    expect(explain.totalCost).toBe(12.34);
    expect(explain.planSummary).toBe("Index Scan");
  });

  it("explainFindByRange throws when table metadata is missing", async () => {
    const ds = createSqlDataSource({
      query: makeQueryFn([]),
      dialect: pgFakeDialect,
      tableMetadata,
    });
    await expect(
      ds.explainFindByRange({
        table: "ghost",
        field: "createdAt",
        from: new Date(0),
        to: new Date(1),
        columns: [],
        limit: 1,
      }),
    ).rejects.toThrow(/No metadata for table 'ghost'/);
  });

  it("explainSql wraps the caller's SQL with the dialect's EXPLAIN prefix and forwards params", async () => {
    const planRow = {
      "QUERY PLAN": [
        { Plan: { "Node Type": "Seq Scan", "Plan Rows": 42, "Total Cost": 9.99 } },
      ],
    };
    const query = makeQueryFn([planRow]);
    const ds = createSqlDataSource({ query, dialect: pgFakeDialect, tableMetadata });

    const result = await ds.explainSql({
      sql: "SELECT * FROM something WHERE id = $1",
      params: [123],
    });

    const args = (query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      sql: string;
      values: unknown[];
    };
    expect(args.sql).toBe(
      "EXPLAIN (FORMAT JSON) SELECT * FROM something WHERE id = $1",
    );
    expect(args.values).toEqual([123]);
    expect(result.estimatedRows).toBe(42);
    expect(result.totalCost).toBe(9.99);
  });

  it("explainSql does NOT consult tableMetadata (whitelist bypass is intentional)", async () => {
    // Pass a table name that isn't in tableMetadata. With the whitelist
    // bypass this must still succeed — schema-level access is the DB
    // role's job, not the SQL builder's.
    const planRow = {
      "QUERY PLAN": [
        { Plan: { "Node Type": "Seq Scan", "Plan Rows": 0, "Total Cost": 0 } },
      ],
    };
    const ds = createSqlDataSource({
      query: makeQueryFn([planRow]),
      dialect: pgFakeDialect,
      tableMetadata,
    });
    const result = await ds.explainSql({ sql: "SELECT 1 FROM not_in_metadata", params: [] });
    expect(result.estimatedRows).toBe(0);
  });

  it("findByJsonPath forwards rows", async () => {
    const rows = [{ id: "u1" }];
    const query = makeQueryFn(rows);
    const ds = createSqlDataSource({ query, dialect: pgFakeDialect, tableMetadata });
    const out = await ds.findByJsonPath({
      table: "users",
      field: "meta",
      path: "$.foo",
      value: 1,
      columns: ["id"],
      limit: 5,
    });
    expect(out).toEqual(rows);
    expect(query).toHaveBeenCalledWith({
      sql: expect.stringContaining("#>>"),
      values: [1, ["foo"], 5],
    });
  });

  it.each([
    { method: "findByPk" as const },
    { method: "findByEq" as const },
    { method: "findByRange" as const },
    { method: "findByJsonPath" as const },
  ])("$method throws when table metadata is missing", async ({ method }) => {
    const ds = createSqlDataSource({
      query: makeQueryFn([]),
      dialect: pgFakeDialect,
      tableMetadata,
    });
    const inputs = {
      findByPk: { table: "ghost", pk: 1, columns: [] },
      findByEq: { table: "ghost", field: "x", value: 1, columns: [], limit: 1 },
      findByRange: {
        table: "ghost",
        field: "x",
        from: new Date(0),
        to: new Date(1),
        columns: [],
        limit: 1,
      },
      findByJsonPath: {
        table: "ghost",
        field: "x",
        path: "$",
        value: 1,
        columns: [],
        limit: 1,
      },
    } as const;
    await expect(
      // The discriminated lookup is awkward to type; cast through any for the
      // dispatch only — input values themselves are well-typed above.
      (ds[method] as (i: unknown) => Promise<unknown>)(inputs[method]),
    ).rejects.toThrow(/No metadata for table 'ghost'/);
  });

  it("findByPk rejects composite primary keys", async () => {
    const ds = createSqlDataSource({
      query: makeQueryFn([]),
      dialect: pgFakeDialect,
      tableMetadata,
    });
    await expect(
      ds.findByPk({ table: "composite_pk", pk: "x", columns: [] }),
    ).rejects.toThrow(/single-column primary key \(got 2\)/);
  });

  describe("dbTableName mapping (logical key vs physical table)", () => {
    const remappedMetadata: RdbTableMetadataMap = {
      // Caller addresses the table as "appUsers" but the physical table is "app_users".
      appUsers: {
        tableName: "appUsers",
        dbTableName: "app_users",
        primaryKey: ["id"],
        fields: {
          id: { type: "string", nullable: false },
          meta: { type: "json", nullable: true },
          createdAt: { type: "datetime", nullable: false },
        },
      },
    };

    it.each([
      {
        method: "findByPk" as const,
        invoke: (ds: ReturnType<typeof createSqlDataSource>) =>
          ds.findByPk({ table: "appUsers", pk: "u1", columns: ["id"] }),
      },
      {
        method: "findByEq" as const,
        invoke: (ds: ReturnType<typeof createSqlDataSource>) =>
          ds.findByEq({
            table: "appUsers",
            field: "id",
            value: "x",
            columns: ["id"],
            limit: 10,
          }),
      },
      {
        method: "findByRange" as const,
        invoke: (ds: ReturnType<typeof createSqlDataSource>) =>
          ds.findByRange({
            table: "appUsers",
            field: "createdAt",
            from: new Date(0),
            to: new Date(1),
            columns: ["id"],
            limit: 10,
          }),
      },
      {
        method: "findByJsonPath" as const,
        invoke: (ds: ReturnType<typeof createSqlDataSource>) =>
          ds.findByJsonPath({
            table: "appUsers",
            field: "meta",
            path: "$.x",
            value: 1,
            columns: ["id"],
            limit: 10,
          }),
      },
    ])("$method emits the physical dbTableName, not the logical key", async ({ invoke }) => {
      const query = makeQueryFn([]);
      const ds = createSqlDataSource({
        query,
        dialect: pgFakeDialect,
        tableMetadata: remappedMetadata,
      });
      await invoke(ds);
      const args = (query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        sql: string;
      };
      expect(args.sql).toContain('"app_users"');
      expect(args.sql).not.toContain('"appUsers"');
    });
  });
});
