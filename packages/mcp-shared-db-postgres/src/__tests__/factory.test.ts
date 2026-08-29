import { describe, expect, it, vi } from "vitest";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { createPostgresDataSource } from "../factory.js";
import type { PgQueryClient } from "../client.js";

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
  client: PgQueryClient;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const client: PgQueryClient = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    on: vi.fn(),
    // pg.Client accepts both `(text, values)` and `({text, values, ...})`.
    // The factory under test uses the config form to set `queryMode:
    // 'extended'`; older callers (introspector, smoke test) still pass
    // text+values positionally.
    query: vi.fn(
      async (
        textOrConfig: string | { text: string; values?: unknown[] },
        values?: unknown[],
      ) => {
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
  return { client, calls };
}

describe("createPostgresDataSource", () => {
  it("findByPk emits the expected pg-shaped SQL", async () => {
    const { client, calls } = makeFakeClient([{ id: "u1", name: "x" }]);
    const ds = createPostgresDataSource({ client, tableMetadata });

    const row = await ds.findByPk({ table: "users", pk: "u1", columns: ["id", "name"] });
    expect(row).toEqual({ id: "u1", name: "x" });
    expect(calls).toEqual([
      {
        sql: 'SELECT "id", "name" FROM "users" WHERE "id" = $1 LIMIT 1',
        values: ["u1"],
      },
    ]);
  });

  it("findByEq emits SQL with two placeholders", async () => {
    const { client, calls } = makeFakeClient([{ id: "u1" }]);
    const ds = createPostgresDataSource({ client, tableMetadata });
    await ds.findByEq({
      table: "users",
      field: "name",
      value: "x",
      columns: ["id"],
      limit: 50,
    });
    expect(calls[0]?.sql).toBe(
      'SELECT "id" FROM "users" WHERE "name" = $1 LIMIT $2',
    );
    expect(calls[0]?.values).toEqual(["x", 50]);
  });

  it("findByRange emits BETWEEN with three placeholders", async () => {
    const { client, calls } = makeFakeClient([]);
    const ds = createPostgresDataSource({ client, tableMetadata });
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
      'SELECT "id" FROM "users" WHERE "createdAt" BETWEEN $1 AND $2 LIMIT $3',
    );
    expect(calls[0]?.values).toEqual([from, to, 10]);
  });

  it("findByJsonPath sends segments as a JS array bound via text[]", async () => {
    const { client, calls } = makeFakeClient([{ id: "u1", meta: {} }]);
    const ds = createPostgresDataSource({ client, tableMetadata });
    await ds.findByJsonPath({
      table: "users",
      field: "meta",
      path: "$.foo.bar",
      value: "z",
      columns: ["id", "meta"],
      limit: 5,
    });
    expect(calls[0]?.sql).toBe(
      'SELECT "id", "meta" FROM "users" WHERE "meta" #>> $1 = $2 LIMIT $3',
    );
    // Segments, value, limit -- placeholders numbered in the order they are
    // emitted. Postgres tolerates any binding order because `$n` carries its
    // own position; MySQL does not, so the dialects allocate in emission
    // order and this assertion pins that.
    // The segments go in as a JS array; pg will coerce that to a text[]
    // bind value at the protocol layer.
    expect(calls[0]?.values).toEqual([["foo", "bar"], "z", 5]);
    expect(Array.isArray((calls[0]?.values ?? [])[0])).toBe(true);
  });

  it("tripwire: still throws if a future regression somehow surfaces Result[] from the driver", async () => {
    // The primary defense is `queryMode: 'extended'` (PG's Parse rejects
    // multi-statement at the wire). This test simulates the secondary
    // tripwire: if a driver / refactor regresses and somehow returns
    // multiple Result objects as an Array, the factory still throws a
    // clear error rather than crashing in the parser.
    const fakeMultiResult = [
      { rows: [{ "?column?": 1 }] },
      { rows: [{ "?column?": 2 }] },
    ];
    const client: PgQueryClient = {
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      on: vi.fn(),
      query: vi.fn(
        async () => fakeMultiResult as unknown as { rows: Record<string, unknown>[] },
      ),
    };
    const ds = createPostgresDataSource({ client, tableMetadata });
    await expect(ds.explainSql({ sql: "SELECT 1; SELECT 2", params: [] })).rejects.toThrow(
      /Multi-statement SQL is not supported/,
    );
  });

  it("forces extended protocol via queryMode: 'extended' (multi-statement is wire-level rejected)", async () => {
    // Lock the load-bearing defense: every adapter call must include
    // `queryMode: 'extended'` so pg-node forces Parse + Bind + Execute,
    // making PG reject multi-statement input before any execution.
    const calls: { sql: string; values: unknown[]; queryMode?: string }[] = [];
    const client: PgQueryClient = {
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      on: vi.fn(),
      query: vi.fn(
        async (
          textOrConfig: string | { text: string; values?: unknown[]; queryMode?: string },
        ) => {
          if (typeof textOrConfig !== "string") {
            calls.push({
              sql: textOrConfig.text,
              values: textOrConfig.values ?? [],
              ...(textOrConfig.queryMode !== undefined && { queryMode: textOrConfig.queryMode }),
            });
          }
          return {
            rows: [
              {
                "QUERY PLAN": [
                  { Plan: { "Node Type": "Result", "Plan Rows": 1, "Total Cost": 0 } },
                ],
              },
            ],
          };
        },
      ),
    };
    const ds = createPostgresDataSource({ client, tableMetadata });
    await ds.explainSql({ sql: "SELECT 1", params: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].queryMode).toBe("extended");
  });

  it("explainSql wraps with EXPLAIN prefix and forwards bind values", async () => {
    const planRows = [
      {
        "QUERY PLAN": [
          { Plan: { "Node Type": "Seq Scan", "Plan Rows": 5, "Total Cost": 9.9 } },
        ],
      },
    ];
    const { client, calls } = makeFakeClient(planRows);
    const ds = createPostgresDataSource({ client, tableMetadata });
    const result = await ds.explainSql({ sql: "SELECT * FROM users WHERE id = $1", params: ["u1"] });
    expect(calls[0]?.sql).toBe(
      "EXPLAIN (FORMAT JSON) SELECT * FROM users WHERE id = $1",
    );
    expect(calls[0]?.values).toEqual(["u1"]);
    expect(result.estimatedRows).toBe(5);
  });
});
