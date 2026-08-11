import { describe, expect, it, vi } from "vitest";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { createMysqlDataSource } from "../factory.js";
import type { MysqlQueryClient } from "../client.js";

const tableMetadata: RdbTableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      name: { type: "string", nullable: false },
      meta: { type: "json", nullable: true },
      createdAt: { type: "datetime", nullable: false },
    },
  },
};

interface QueryCall {
  sql: string;
  values: unknown[];
}

function makeFakeClient(rows: Record<string, unknown>[]): {
  client: MysqlQueryClient;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const client: MysqlQueryClient = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    onError: vi.fn(),
    query: vi.fn(async (args: { text: string; values?: unknown[] }) => {
      calls.push({ sql: args.text, values: args.values ?? [] });
      return { rows };
    }),
  };
  return { client, calls };
}

describe("createMysqlDataSource", () => {
  it("findByPk emits backtick-quoted SQL with `?` placeholders", async () => {
    const { client, calls } = makeFakeClient([{ id: "u1", name: "x" }]);
    const ds = createMysqlDataSource({ client, tableMetadata });

    const row = await ds.findByPk({ table: "users", pk: "u1", columns: ["id", "name"] });
    expect(row).toEqual({ id: "u1", name: "x" });
    expect(calls).toEqual([
      {
        sql: "SELECT `id`, `name` FROM `users` WHERE `id` = ? LIMIT 1",
        values: ["u1"],
      },
    ]);
  });

  it("findByEq binds value + limit positionally", async () => {
    const { client, calls } = makeFakeClient([{ id: "u1" }]);
    const ds = createMysqlDataSource({ client, tableMetadata });
    await ds.findByEq({
      table: "users",
      field: "name",
      value: "x",
      columns: ["id"],
      limit: 50,
    });
    expect(calls[0]?.sql).toBe(
      "SELECT `id` FROM `users` WHERE `name` = ? LIMIT ?",
    );
    expect(calls[0]?.values).toEqual(["x", 50]);
  });

  it("findByRange emits BETWEEN with three placeholders", async () => {
    const { client, calls } = makeFakeClient([]);
    const ds = createMysqlDataSource({ client, tableMetadata });
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-02-01T00:00:00Z");
    await ds.findByRange({
      table: "users",
      field: "createdAt",
      from,
      to,
      columns: ["id"],
      limit: 10,
    });
    expect(calls[0]?.sql).toBe(
      "SELECT `id` FROM `users` WHERE `createdAt` BETWEEN ? AND ? LIMIT ?",
    );
    expect(calls[0]?.values).toEqual([from, to, 10]);
  });

  it("findByJsonPath sends the raw path string as a bound `?` value (not concatenated)", async () => {
    // Lock the load-bearing JSON-path-injection defence at the wiring level,
    // not just the dialect: the path must come through as a separately-bound
    // value in the `values` array, never spliced into the SQL.
    const { client, calls } = makeFakeClient([{ id: "u1", meta: {} }]);
    const ds = createMysqlDataSource({ client, tableMetadata });
    await ds.findByJsonPath({
      table: "users",
      field: "meta",
      path: "$.foo.bar",
      value: "z",
      columns: ["id", "meta"],
      limit: 5,
    });
    expect(calls[0]?.sql).toBe(
      "SELECT `id`, `meta` FROM `users` WHERE JSON_UNQUOTE(JSON_EXTRACT(`meta`, ?)) = ? LIMIT ?",
    );
    // value -> path -> limit: bind order set by `buildFindByJsonPath`
    // (value first, then dialect-allocated path, then limit). Path appears
    // as a separately-bound string, not interpolated.
    expect(calls[0]?.values).toEqual(["z", "$.foo.bar", 5]);
  });

  it("explainSql wraps with EXPLAIN FORMAT=JSON and forwards bind values", async () => {
    const planRows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            cost_info: { query_cost: "5.5" },
            table: {
              table_name: "users",
              access_type: "ALL",
              rows_examined_per_scan: 9,
            },
          },
        }),
      },
    ];
    const { client, calls } = makeFakeClient(planRows);
    const ds = createMysqlDataSource({ client, tableMetadata });
    const result = await ds.explainSql({ sql: "SELECT * FROM users WHERE id = ?", params: ["u1"] });
    expect(calls[0]?.sql).toBe(
      "EXPLAIN FORMAT=JSON SELECT * FROM users WHERE id = ?",
    );
    expect(calls[0]?.values).toEqual(["u1"]);
    expect(result.estimatedRows).toBe(9);
    expect(result.totalCost).toBe(5.5);
  });

  it("explainFindByRange wraps the same range SELECT with EXPLAIN", async () => {
    const planRows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            table: {
              table_name: "users",
              access_type: "range",
              key: "ix_created",
              rows_examined_per_scan: 100,
            },
          },
        }),
      },
    ];
    const { client, calls } = makeFakeClient(planRows);
    const ds = createMysqlDataSource({ client, tableMetadata });
    await ds.explainFindByRange({
      table: "users",
      field: "createdAt",
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
      columns: ["id"],
      limit: 10,
    });
    expect(calls[0]?.sql).toBe(
      "EXPLAIN FORMAT=JSON SELECT `id` FROM `users` WHERE `createdAt` BETWEEN ? AND ? LIMIT ?",
    );
  });
});
