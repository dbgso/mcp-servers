/**
 * Shared dialect fakes for builder + data-source tests.
 *
 * - `pgFakeDialect`: mimics Postgres — `"ident"`, `$N` placeholders, and a
 *   JSON op that pushes an extra `text[]` segments placeholder so we can
 *   assert that the dialect can allocate further placeholders mid-build.
 * - `mysqlFakeDialect`: mimics MySQL — backticked idents, `?` placeholders,
 *   and a JSON op that consumes the raw `$.foo.bar` path as a single literal.
 */
import type { Dialect } from "../dialect.js";

export const pgFakeDialect: Dialect = {
  quoteIdent(name) {
    return `"${name.replace(/"/g, '""')}"`;
  },
  placeholder(index) {
    return `$${index}`;
  },
  jsonPathEquals({ columnSql, path, valuePlaceholder, params }) {
    const segmentsPh = params.add(path.segments);
    return `${columnSql} #>> ${segmentsPh} = ${valuePlaceholder}`;
  },
  explainPrefix() {
    return "EXPLAIN (FORMAT JSON)";
  },
  parseExplainResult(rows) {
    const first = rows[0] as
      | { "QUERY PLAN"?: { Plan?: { "Plan Rows"?: number; "Total Cost"?: number; "Node Type"?: string } }[] }
      | undefined;
    const plan = first?.["QUERY PLAN"]?.[0]?.Plan;
    return {
      estimatedRows: plan?.["Plan Rows"] ?? null,
      totalCost: plan?.["Total Cost"] ?? null,
      planSummary: plan?.["Node Type"] ?? "(unknown)",
      raw: plan ?? rows,
    };
  },
};

export const mysqlFakeDialect: Dialect = {
  quoteIdent(name) {
    return `\`${name.replace(/`/g, "``")}\``;
  },
  placeholder() {
    return "?";
  },
  jsonPathEquals({ columnSql, path, valuePlaceholder }) {
    // MySQL takes the raw `$.foo.bar` literal — no extra placeholders.
    return `JSON_EXTRACT(${columnSql}, '${path.raw}') = ${valuePlaceholder}`;
  },
  explainPrefix() {
    return "EXPLAIN FORMAT=JSON";
  },
  parseExplainResult(rows) {
    // MySQL returns a single row whose `EXPLAIN` column is a JSON string.
    const first = rows[0] as { EXPLAIN?: string } | undefined;
    if (!first?.EXPLAIN) {
      return { estimatedRows: null, totalCost: null, planSummary: "(no plan)", raw: rows };
    }
    const parsed = JSON.parse(first.EXPLAIN) as {
      query_block?: { table?: { rows_examined_per_scan?: number; access_type?: string } };
    };
    const tbl = parsed.query_block?.table;
    return {
      estimatedRows: tbl?.rows_examined_per_scan ?? null,
      totalCost: null,
      planSummary: tbl?.access_type ?? "(unknown)",
      raw: parsed,
    };
  },
};
