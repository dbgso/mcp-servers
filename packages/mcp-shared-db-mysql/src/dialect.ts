/**
 * MySQL `Dialect` for mcp-shared-db-sql.
 *
 * - `quoteIdent` wraps in backticks and doubles embedded backticks (MySQL's
 *   ANSI-quote-disabled default). Works regardless of `sql_mode`'s
 *   ANSI_QUOTES setting because backticks are universal.
 * - `placeholder` returns `?` — mysql2 uses positional binds and ignores the
 *   index.
 * - `jsonPathEquals` uses `JSON_UNQUOTE(JSON_EXTRACT(col, ?)) = ?` and binds
 *   the path string. **The path bind is load-bearing**: never interpolate
 *   `path.raw` into the SQL — that would re-open JSON-path injection (the
 *   op-layer regex in `mcp-shared-db/src/operations/json-search.ts` is
 *   defense-in-depth, but the dialect bind is the primary defence).
 * - `explainPrefix` emits `EXPLAIN FORMAT=JSON` — like PG's, this is
 *   plan-only (no ANALYZE), the query never executes for real.
 * - `parseExplainResult` parses the single-row `{ EXPLAIN: "<json>" }` shape
 *   that mysql2 returns and walks the plan tree to find the worst-case scan
 *   width across all leaves.
 */
import type { Dialect, DialectExplainResult } from "mcp-shared-db-sql";

interface MysqlScanLeaf {
  table_name?: string;
  access_type?: string;
  key?: string;
  rows_examined_per_scan?: number;
}

interface MysqlNestedLoopEntry {
  table?: MysqlScanLeaf;
}

interface MysqlSubqueryWrapper {
  query_block?: MysqlQueryBlock;
}

interface MysqlUnionResult {
  query_specifications?: MysqlSubqueryWrapper[];
}

// MySQL 8's EXPLAIN FORMAT=JSON nests the actual table scans under a handful
// of operation wrappers (ORDER BY, GROUP BY, DISTINCT). The wrapper itself
// has no `rows_examined_per_scan`; the underlying `table` (or `nested_loop`)
// is what we want.
interface MysqlOperationWrapper {
  table?: MysqlScanLeaf;
  nested_loop?: MysqlNestedLoopEntry[];
}

interface MysqlQueryBlock {
  cost_info?: { query_cost?: string };
  table?: MysqlScanLeaf & { attached_subqueries?: MysqlSubqueryWrapper[] };
  nested_loop?: MysqlNestedLoopEntry[];
  union_result?: MysqlUnionResult;
  ordering_operation?: MysqlOperationWrapper;
  grouping_operation?: MysqlOperationWrapper;
  duplicates_removal?: MysqlOperationWrapper;
  select_list_subqueries?: MysqlSubqueryWrapper[];
}

interface MysqlExplainPlan {
  query_block?: MysqlQueryBlock;
}

interface MysqlExplainRow {
  EXPLAIN?: string | MysqlExplainPlan;
}

/**
 * Walk a MySQL plan tree and collect every leaf `table` node — including
 * those nested under nested_loop / union / subquery / ordering / grouping
 * wrappers. Used to compute the worst-case scan width.
 */
function collectScanLeaves(block: MysqlQueryBlock | undefined): MysqlScanLeaf[] {
  if (!block) return [];
  const leaves: MysqlScanLeaf[] = [];
  if (block.table) {
    leaves.push(block.table);
    if (block.table.attached_subqueries) {
      for (const sub of block.table.attached_subqueries) {
        leaves.push(...collectScanLeaves(sub.query_block));
      }
    }
  }
  if (block.nested_loop) {
    for (const entry of block.nested_loop) {
      if (entry.table) leaves.push(entry.table);
    }
  }
  if (block.union_result?.query_specifications) {
    for (const spec of block.union_result.query_specifications) {
      leaves.push(...collectScanLeaves(spec.query_block));
    }
  }
  if (block.select_list_subqueries) {
    for (const sub of block.select_list_subqueries) {
      leaves.push(...collectScanLeaves(sub.query_block));
    }
  }
  // Walk past ordering/grouping/duplicates wrappers — the underlying table or
  // join is the scan we care about, not the operation node itself.
  for (const wrapper of [
    block.ordering_operation,
    block.grouping_operation,
    block.duplicates_removal,
  ]) {
    if (!wrapper) continue;
    if (wrapper.table) leaves.push(wrapper.table);
    if (wrapper.nested_loop) {
      for (const entry of wrapper.nested_loop) {
        if (entry.table) leaves.push(entry.table);
      }
    }
  }
  return leaves;
}

function summariseLeaf(leaf: MysqlScanLeaf): string {
  const parts: string[] = [];
  parts.push(leaf.access_type ?? "scan");
  if (leaf.key) parts.push(`using ${leaf.key}`);
  if (leaf.table_name) parts.push(`on ${leaf.table_name}`);
  return parts.join(" ");
}

function parseExplainPayload(value: unknown): MysqlExplainPlan | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as MysqlExplainPlan;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") {
    return value as MysqlExplainPlan;
  }
  return null;
}

export const mysqlDialect: Dialect = {
  quoteIdent(name: string): string {
    return `\`${name.replace(/`/g, "``")}\``;
  },
  placeholder(): string {
    return "?";
  },
  jsonPathEquals({ columnSql, path, value }) {
    // The path is a bound value, never interpolated into the SQL — the
    // op-layer Zod regex is defense-in-depth; this is the load-bearing
    // defence. Lock-tested in dialect.test.ts.
    return {
      sql: [`JSON_UNQUOTE(JSON_EXTRACT(${columnSql}, `, ")) = ", ""],
      values: [path.raw, value],
    };
  },
  explainPrefix(): string {
    return "EXPLAIN FORMAT=JSON";
  },
  parseExplainResult(rows: unknown[]): DialectExplainResult {
    if (!Array.isArray(rows)) {
      return {
        estimatedRows: null,
        totalCost: null,
        planSummary: "(no plan returned)",
        raw: rows,
      };
    }
    const first = rows[0] as MysqlExplainRow | undefined;
    const plan = parseExplainPayload(first?.EXPLAIN);
    const block = plan?.query_block;
    if (!plan || !block) {
      return {
        estimatedRows: null,
        totalCost: null,
        planSummary: "(no plan returned)",
        raw: rows,
      };
    }
    // Pick the leaf with the largest scan width. The auto-EXPLAIN guard's
    // intent is "is any scan too wide?" — taking the max protects against
    // joins where the driving table is small but a follow-up scan is huge.
    const worst = pickWorstLeaf(collectScanLeaves(block));
    if (!worst) {
      return {
        estimatedRows: null,
        totalCost: parseCost(block.cost_info?.query_cost),
        planSummary: "(plan has no scan leaves)",
        raw: plan,
      };
    }
    return {
      estimatedRows: worst.rows_examined_per_scan ?? null,
      totalCost: parseCost(block.cost_info?.query_cost),
      planSummary: summariseLeaf(worst),
      raw: plan,
    };
  },
};

function pickWorstLeaf(
  leaves: MysqlScanLeaf[],
): MysqlScanLeaf | undefined {
  let worst: MysqlScanLeaf | undefined;
  for (const leaf of leaves) {
    if (
      worst === undefined ||
      (leaf.rows_examined_per_scan ?? -1) >
        (worst.rows_examined_per_scan ?? -1)
    ) {
      worst = leaf;
    }
  }
  return worst;
}

/**
 * MySQL EXPLAIN reports `query_cost` as a stringified decimal (e.g. `"1.05"`).
 * Returns `null` for missing / unparseable values so the consumer can render
 * "unknown" rather than `NaN`.
 */
function parseCost(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
