import { describe, expect, it } from "vitest";
import { ParamBuilderImpl } from "mcp-shared-db-sql";
import { mysqlDialect } from "../dialect.js";

describe("mysqlDialect.quoteIdent", () => {
  it.each([
    { input: "users", expected: "`users`" },
    { input: "we`ird", expected: "`we``ird`" },
    { input: "snake_case", expected: "`snake_case`" },
  ])("quotes '$input' as $expected", ({ input, expected }) => {
    expect(mysqlDialect.quoteIdent(input)).toBe(expected);
  });
});

describe("mysqlDialect.placeholder", () => {
  it.each([1, 2, 42])("returns '?' regardless of index (%i)", (index) => {
    expect(mysqlDialect.placeholder(index)).toBe("?");
  });
});

describe("mysqlDialect.jsonPathEquals", () => {
  it("binds the JSON path string as a `?` parameter (not string-concat)", () => {
    // Lock-test for the load-bearing JSON path injection defence: the path
    // value MUST go through params.add() and appear in the build() output as
    // a separately-bound value. A regression that interpolates path.raw
    // straight into the SQL would break this assertion.
    const params = new ParamBuilderImpl(mysqlDialect);
    const valuePh = params.add("z");
    const fragment = mysqlDialect.jsonPathEquals({
      columnSql: "`meta`",
      path: { raw: "$.foo.bar", segments: ["foo", "bar"] },
      valuePlaceholder: valuePh,
      params,
    });
    expect(fragment).toBe(
      "JSON_UNQUOTE(JSON_EXTRACT(`meta`, ?)) = ?",
    );
    expect(params.build()).toEqual(["z", "$.foo.bar"]);
  });

  it("binds the root path '$' too", () => {
    const params = new ParamBuilderImpl(mysqlDialect);
    const valuePh = params.add(1);
    const fragment = mysqlDialect.jsonPathEquals({
      columnSql: "`meta`",
      path: { raw: "$", segments: [] },
      valuePlaceholder: valuePh,
      params,
    });
    expect(fragment).toBe(
      "JSON_UNQUOTE(JSON_EXTRACT(`meta`, ?)) = ?",
    );
    expect(params.build()).toEqual([1, "$"]);
  });
});

describe("mysqlDialect.explainPrefix", () => {
  it("emits MySQL's JSON-format EXPLAIN prefix", () => {
    expect(mysqlDialect.explainPrefix()).toBe("EXPLAIN FORMAT=JSON");
  });
});

describe("mysqlDialect.parseExplainResult", () => {
  it("extracts a single-table plan from mysql2's stringified EXPLAIN row", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            select_id: 1,
            cost_info: { query_cost: "0.35" },
            table: {
              table_name: "users",
              access_type: "const",
              key: "PRIMARY",
              rows_examined_per_scan: 1,
            },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(1);
    expect(result.totalCost).toBe(0.35);
    expect(result.planSummary).toBe("const using PRIMARY on users");
  });

  it("accepts pre-parsed object form (driver auto-parsing path)", () => {
    // mysql2 returns a string today, but a future driver / wrapper may
    // auto-parse JSON columns. Lock both paths so a behavioural change in
    // mysql2 doesn't silently break the parser.
    const rows = [
      {
        EXPLAIN: {
          query_block: {
            cost_info: { query_cost: "1.00" },
            table: {
              table_name: "x",
              access_type: "ALL",
              rows_examined_per_scan: 7,
            },
          },
        },
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(7);
    expect(result.totalCost).toBe(1);
    expect(result.planSummary).toBe("ALL on x");
  });

  it("picks the worst-case scan across nested_loop join leaves", () => {
    // Driving table is small (1k rows) but the joined table scans 1M.
    // The guard should trip on the 1M scan, not the 1k driving scan.
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            cost_info: { query_cost: "100000.00" },
            nested_loop: [
              {
                table: {
                  table_name: "u",
                  access_type: "ALL",
                  rows_examined_per_scan: 1000,
                },
              },
              {
                table: {
                  table_name: "p",
                  access_type: "ALL",
                  rows_examined_per_scan: 1_000_000,
                },
              },
            ],
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(1_000_000);
    expect(result.totalCost).toBe(100000);
    expect(result.planSummary).toBe("ALL on p");
  });

  it("walks into ordering_operation wrappers", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            cost_info: { query_cost: "5000.00" },
            ordering_operation: {
              using_filesort: false,
              table: {
                table_name: "events",
                access_type: "ALL",
                rows_examined_per_scan: 50_000,
              },
            },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(50_000);
    expect(result.planSummary).toBe("ALL on events");
  });

  it("walks into grouping_operation with a nested_loop child", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            cost_info: { query_cost: "9.99" },
            grouping_operation: {
              using_temporary_table: false,
              nested_loop: [
                {
                  table: {
                    table_name: "a",
                    access_type: "eq_ref",
                    rows_examined_per_scan: 1,
                  },
                },
                {
                  table: {
                    table_name: "b",
                    access_type: "ref",
                    key: "ix_b_aid",
                    rows_examined_per_scan: 5,
                  },
                },
              ],
            },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(5);
    expect(result.planSummary).toBe("ref using ix_b_aid on b");
  });

  it("walks into duplicates_removal wrappers", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            duplicates_removal: {
              using_temporary_table: true,
              table: {
                table_name: "logs",
                access_type: "ALL",
                rows_examined_per_scan: 200,
              },
            },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(200);
    expect(result.planSummary).toBe("ALL on logs");
  });

  it("descends UNION subplans via union_result.query_specifications", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            cost_info: { query_cost: "30.00" },
            union_result: {
              using_temporary_table: false,
              query_specifications: [
                {
                  query_block: {
                    table: {
                      table_name: "a",
                      access_type: "ALL",
                      rows_examined_per_scan: 100,
                    },
                  },
                },
                {
                  query_block: {
                    table: {
                      table_name: "b",
                      access_type: "ALL",
                      rows_examined_per_scan: 200,
                    },
                  },
                },
              ],
            },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(200);
    expect(result.planSummary).toBe("ALL on b");
  });

  it("includes attached_subqueries in worst-case scan calculation", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            table: {
              table_name: "outer",
              access_type: "ALL",
              rows_examined_per_scan: 10,
              attached_subqueries: [
                {
                  query_block: {
                    table: {
                      table_name: "inner",
                      access_type: "ALL",
                      rows_examined_per_scan: 1_000_000,
                    },
                  },
                },
              ],
            },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(1_000_000);
    expect(result.planSummary).toBe("ALL on inner");
  });

  it("descends select_list_subqueries", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            table: {
              table_name: "outer",
              access_type: "ALL",
              rows_examined_per_scan: 100,
            },
            select_list_subqueries: [
              {
                query_block: {
                  table: {
                    table_name: "scalar_sub",
                    access_type: "ALL",
                    rows_examined_per_scan: 500,
                  },
                },
              },
            ],
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(500);
    expect(result.planSummary).toBe("ALL on scalar_sub");
  });

  it("returns null estimates when the rows array is empty", () => {
    const result = mysqlDialect.parseExplainResult([]);
    expect(result.estimatedRows).toBeNull();
    expect(result.totalCost).toBeNull();
    expect(result.planSummary).toContain("no plan");
  });

  it("returns null estimates for a non-array input (defensive guard)", () => {
    // QueryFn contract is `unknown[]`, but a misbehaving driver could hand us
    // undefined / object. Locked so the defensive branch survives refactors.
    const result = mysqlDialect.parseExplainResult(
      undefined as unknown as unknown[],
    );
    expect(result.estimatedRows).toBeNull();
    expect(result.totalCost).toBeNull();
    expect(result.planSummary).toContain("no plan");
  });

  it("returns null estimates when the EXPLAIN payload is missing", () => {
    const rows = [{}];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBeNull();
    expect(result.planSummary).toContain("no plan");
  });

  it("returns null estimates when EXPLAIN is unparseable JSON", () => {
    const rows = [{ EXPLAIN: "not json" }];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBeNull();
    expect(result.planSummary).toContain("no plan");
  });

  it("returns no-leaves marker when query_block contains no recognisable scan node", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: { cost_info: { query_cost: "0.5" } },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBeNull();
    expect(result.totalCost).toBe(0.5);
    expect(result.planSummary).toContain("no scan leaves");
  });

  it("treats a missing query_cost as null totalCost", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            table: { table_name: "t", access_type: "ALL", rows_examined_per_scan: 1 },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.totalCost).toBeNull();
  });

  it("treats a non-numeric query_cost as null totalCost", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            cost_info: { query_cost: "n/a" },
            table: { table_name: "t", access_type: "ALL", rows_examined_per_scan: 1 },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.totalCost).toBeNull();
  });

  it("falls back to 'scan' summary when access_type is missing", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: {
            table: { table_name: "t", rows_examined_per_scan: 3 },
          },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.planSummary).toBe("scan on t");
  });

  it("treats missing rows_examined_per_scan as null estimatedRows", () => {
    const rows = [
      {
        EXPLAIN: JSON.stringify({
          query_block: { table: { table_name: "t", access_type: "ALL" } },
        }),
      },
    ];
    const result = mysqlDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBeNull();
  });
});
