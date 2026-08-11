/**
 * PostgreSQL `Dialect` for mcp-shared-db-sql.
 *
 * - `quoteIdent` doubles embedded `"` per the SQL standard.
 * - `placeholder` returns `$N` (1-based) — pg's bind syntax.
 * - `jsonPathEquals` uses `col #>> $segments` so the same fragment works on
 *   both `json` and `jsonb` columns. Segments travel as a JS array; `pg`
 *   serialises that as a `text[]` bind value.
 * - `explainPrefix` emits `EXPLAIN (FORMAT JSON)` — no ANALYZE, so the query
 *   is *not* executed; we only get the planner's pre-flight estimate.
 * - `parseExplainResult` walks the JSON plan tree and pulls out the leading
 *   node's row / cost estimate plus a one-line summary.
 */
import type { Dialect, DialectExplainResult } from "mcp-shared-db-sql";

interface PgPlan {
  "Node Type"?: string;
  "Index Name"?: string;
  "Relation Name"?: string;
  "Plan Rows"?: number;
  "Total Cost"?: number;
  Plans?: PgPlan[];
}

interface PgExplainRow {
  "QUERY PLAN"?: { Plan?: PgPlan }[];
}

// Wrapper nodes that don't reduce scan width on their own — their Plan Rows
// reflects post-LIMIT/SORT/aggregation output, not how many rows the planner
// expects to *touch*. Walk past them to reach the underlying scan whose
// estimate actually matters for cost-control purposes.
const PG_WRAPPER_NODES = new Set([
  "Limit",
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
]);

function findScanNode(plan: PgPlan): PgPlan {
  let node = plan;
  while (
    PG_WRAPPER_NODES.has(node["Node Type"] ?? "") &&
    node.Plans &&
    node.Plans.length > 0 &&
    node.Plans[0] !== undefined
  ) {
    node = node.Plans[0];
  }
  return node;
}

function summarisePgPlan(plan: PgPlan): string {
  const node = plan["Node Type"] ?? "Unknown";
  const rel = plan["Relation Name"];
  const idx = plan["Index Name"];
  const parts: string[] = [node];
  if (idx) parts.push(`using ${idx}`);
  if (rel) parts.push(`on ${rel}`);
  return parts.join(" ");
}

export const postgresDialect: Dialect = {
  quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  },
  placeholder(index: number): string {
    return `$${index}`;
  },
  jsonPathEquals({ columnSql, path, valuePlaceholder, params }) {
    const segmentsPh = params.add(path.segments);
    return `${columnSql} #>> ${segmentsPh} = ${valuePlaceholder}`;
  },
  explainPrefix(): string {
    return "EXPLAIN (FORMAT JSON)";
  },
  parseExplainResult(rows: unknown[]): DialectExplainResult {
    // Defensive: the QueryFn contract is `unknown[]`, but real-world driver
    // mishaps (a badly-formed query result, an unexpected adapter return
    // shape) can hand us non-array. Don't let those crash the parser.
    if (!Array.isArray(rows)) {
      return {
        estimatedRows: null,
        totalCost: null,
        planSummary: "(no plan returned)",
        raw: rows,
      };
    }
    // pg returns a single row whose `QUERY PLAN` column is a JSON array
    // wrapping one root `Plan` node.
    const first = rows[0] as PgExplainRow | undefined;
    const plan = first?.["QUERY PLAN"]?.[0]?.Plan;
    if (!plan) {
      return {
        estimatedRows: null,
        totalCost: null,
        planSummary: "(no plan returned)",
        raw: rows,
      };
    }
    // Walk past Limit/Sort/Aggregate-style wrappers — their Plan Rows
    // reflects the LIMIT-capped output, not the underlying scan width.
    const scan = findScanNode(plan);
    return {
      estimatedRows: scan["Plan Rows"] ?? null,
      // Keep totalCost from the root so it accounts for the full pipeline
      // (planner already factored LIMIT into the cost number).
      totalCost: plan["Total Cost"] ?? null,
      planSummary: summarisePgPlan(scan),
      raw: plan,
    };
  },
};
