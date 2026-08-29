import { describe, expect, it } from "vitest";
import { ParamBuilderImpl } from "mcp-shared-db-sql";
import { postgresDialect } from "../dialect.js";

describe("postgresDialect.quoteIdent", () => {
  it.each([
    { input: "users", expected: '"users"' },
    { input: 'we"ird', expected: '"we""ird"' },
    { input: "snake_case", expected: '"snake_case"' },
  ])("quotes '$input' as $expected", ({ input, expected }) => {
    expect(postgresDialect.quoteIdent(input)).toBe(expected);
  });
});

describe("postgresDialect.placeholder", () => {
  it.each([
    { index: 1, expected: "$1" },
    { index: 2, expected: "$2" },
    { index: 42, expected: "$42" },
  ])("returns '$expected' for 1-based index $index", ({ index, expected }) => {
    expect(postgresDialect.placeholder(index)).toBe(expected);
  });
});

describe("postgresDialect.jsonPathEquals", () => {
  it("emits #>> with a separately-bound text[] segments param", () => {
    const params = new ParamBuilderImpl(postgresDialect);
    const fragment = postgresDialect.jsonPathEquals({
      columnSql: '"meta"',
      path: { raw: "$.foo.bar", segments: ["foo", "bar"] },
      value: "z",
      params,
    });
    // Segments first, value second -- the order they appear in the fragment.
    expect(fragment).toBe('"meta" #>> $1 = $2');
    expect(params.build()).toEqual([["foo", "bar"], "z"]);
  });

  it("passes empty segments array for the root path", () => {
    const params = new ParamBuilderImpl(postgresDialect);
    // A placeholder allocated by the caller beforehand, so the assertion also
    // covers the dialect numbering from wherever the builder left off.
    params.add(1);
    const fragment = postgresDialect.jsonPathEquals({
      columnSql: '"meta"',
      path: { raw: "$", segments: [] },
      value: "z",
      params,
    });
    expect(fragment).toBe('"meta" #>> $2 = $3');
    expect(params.build()).toEqual([1, [], "z"]);
  });
});

describe("postgresDialect.explainPrefix", () => {
  it("emits the JSON-format EXPLAIN prefix without ANALYZE", () => {
    expect(postgresDialect.explainPrefix()).toBe("EXPLAIN (FORMAT JSON)");
  });
});

describe("postgresDialect.parseExplainResult", () => {
  it("extracts row / cost estimates and a one-line summary from a typical Index Scan plan", () => {
    const rows = [
      {
        "QUERY PLAN": [
          {
            Plan: {
              "Node Type": "Index Scan",
              "Index Name": "users_pkey",
              "Relation Name": "users",
              "Plan Rows": 1,
              "Total Cost": 8.27,
            },
          },
        ],
      },
    ];
    const result = postgresDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(1);
    expect(result.totalCost).toBe(8.27);
    expect(result.planSummary).toBe("Index Scan using users_pkey on users");
  });

  it("summarises a Seq Scan plan with the relation name", () => {
    const rows = [
      {
        "QUERY PLAN": [
          {
            Plan: {
              "Node Type": "Seq Scan",
              "Relation Name": "events",
              "Plan Rows": 12345,
              "Total Cost": 1100.5,
            },
          },
        ],
      },
    ];
    const result = postgresDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(12345);
    expect(result.totalCost).toBe(1100.5);
    expect(result.planSummary).toBe("Seq Scan on events");
  });

  it("returns null estimates when the plan is missing entirely", () => {
    const result = postgresDialect.parseExplainResult([]);
    expect(result.estimatedRows).toBeNull();
    expect(result.totalCost).toBeNull();
    expect(result.planSummary).toContain("no plan");
  });

  it("returns a null plan summary for non-array input (defensive guard)", () => {
    // The QueryFn contract says `unknown[]`, but a misbehaving driver could
    // hand us undefined / object / non-array. Lock the defensive branch with
    // a test so it can't be deleted as "dead code" in a refactor.
    const result = postgresDialect.parseExplainResult(
      undefined as unknown as unknown[],
    );
    expect(result.estimatedRows).toBeNull();
    expect(result.totalCost).toBeNull();
    expect(result.planSummary).toContain("no plan");
  });

  it("walks past a Limit wrapper to read scan-width rows from the child", () => {
    // LIMIT-capped queries put a `Limit` node on top whose Plan Rows is the
    // LIMIT (post-output count). The actual scan estimate sits on the child
    // Seq/Index Scan and is the number we want to compare against the
    // safety threshold.
    const rows = [
      {
        "QUERY PLAN": [
          {
            Plan: {
              "Node Type": "Limit",
              "Plan Rows": 5,
              "Total Cost": 1234.56,
              Plans: [
                {
                  "Node Type": "Seq Scan",
                  "Relation Name": "huge_table",
                  "Plan Rows": 7_500_000,
                  "Total Cost": 1234.56,
                },
              ],
            },
          },
        ],
      },
    ];
    const result = postgresDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(7_500_000);
    expect(result.totalCost).toBe(1234.56);
    expect(result.planSummary).toBe("Seq Scan on huge_table");
  });

  it.each([
    "Sort",
    "Aggregate",
    "HashAggregate",
    "GroupAggregate",
    "WindowAgg",
    "Materialize",
    "Result",
    "Subquery Scan",
    "Unique",
    "Gather",
    "Gather Merge",
    "LockRows",
  ])("treats %s as a wrapper and reads the child's scan estimate", (wrapper) => {
    const rows = [
      {
        "QUERY PLAN": [
          {
            Plan: {
              "Node Type": wrapper,
              "Plan Rows": 1,
              "Total Cost": 99,
              Plans: [
                {
                  "Node Type": "Index Scan",
                  "Index Name": "ix_x",
                  "Relation Name": "t",
                  "Plan Rows": 9999,
                  "Total Cost": 50,
                },
              ],
            },
          },
        ],
      },
    ];
    const result = postgresDialect.parseExplainResult(rows);
    expect(result.estimatedRows).toBe(9999);
    expect(result.planSummary).toBe("Index Scan using ix_x on t");
  });
});
