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

type JsonPathEqualsInput = Parameters<Dialect["jsonPathEquals"]>[0];

interface MysqlScanLeaf {
  table_name?: string;
  access_type?: string;
  key?: string;
  rows_examined_per_scan?: number;
}

interface MysqlSubqueryWrapper {
  query_block?: MysqlPlanNode;
}

/** A `table` node, which can itself carry further sub-plans. */
interface MysqlTableNode extends MysqlScanLeaf {
  attached_subqueries?: MysqlSubqueryWrapper[];
  /** Derived table: the plan that fills it. */
  materialized_from_subquery?: MysqlSubqueryWrapper;
}

/**
 * Any node of a MySQL 8 EXPLAIN FORMAT=JSON plan that can hold scans: the
 * query block itself, a `nested_loop` entry, and the operation wrappers
 * (ORDER BY, GROUP BY, DISTINCT). They share one shape, and wrappers nest
 * inside each other (`ordering_operation` -> `grouping_operation` -> ...), so
 * the walk treats them all alike and recurses.
 */
interface MysqlPlanNode {
  table?: MysqlTableNode;
  nested_loop?: MysqlPlanNode[];
  union_result?: { query_specifications?: MysqlSubqueryWrapper[] };
  select_list_subqueries?: MysqlSubqueryWrapper[];
  ordering_operation?: MysqlPlanNode;
  grouping_operation?: MysqlPlanNode;
  duplicates_removal?: MysqlPlanNode;
}

interface MysqlQueryBlock extends MysqlPlanNode {
  cost_info?: { query_cost?: string };
}

interface MysqlExplainPlan {
  query_block?: MysqlQueryBlock;
}

interface MysqlExplainRow {
  EXPLAIN?: string | MysqlExplainPlan;
}

// Operation wrappers have no `rows_examined_per_scan` of their own; the
// table or join underneath is the scan we care about.
const OPERATION_WRAPPERS = [
  "ordering_operation",
  "grouping_operation",
  "duplicates_removal",
] as const;

/**
 * Walk a MySQL plan tree and collect every leaf `table` node — including
 * those nested under nested_loop / union / subquery / derived-table /
 * ordering / grouping wrappers, at any depth. Used to compute the worst-case
 * scan width.
 */
function collectScanLeaves(node: MysqlPlanNode | undefined): MysqlScanLeaf[] {
  if (!node) return [];
  return [
    ...collectTableLeaves(node.table),
    ...(node.nested_loop ?? []).flatMap((entry) => collectScanLeaves(entry)),
    ...collectSubqueryLeaves(node.union_result?.query_specifications),
    ...collectSubqueryLeaves(node.select_list_subqueries),
    ...OPERATION_WRAPPERS.flatMap((key) => collectScanLeaves(node[key])),
  ];
}

function collectTableLeaves(table: MysqlTableNode | undefined): MysqlScanLeaf[] {
  if (!table) return [];
  return [
    table,
    ...collectSubqueryLeaves(table.attached_subqueries),
    ...collectScanLeaves(table.materialized_from_subquery?.query_block),
  ];
}

function collectSubqueryLeaves(
  wrappers: MysqlSubqueryWrapper[] | undefined,
): MysqlScanLeaf[] {
  return (wrappers ?? []).flatMap((sub) => collectScanLeaves(sub.query_block));
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

export class MysqlDialect implements Dialect {
  quoteIdent(name: string): string {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  placeholder(): string {
    return "?";
  }
  jsonPathEquals({
    columnSql,
    path,
    valuePlaceholder,
    params,
  }: JsonPathEqualsInput): string {
    // Bind the path — never interpolate `path.raw` into the SQL. The
    // op-layer Zod regex is defense-in-depth; the bind is the load-bearing
    // defence. Lock-tested in dialect.test.ts.
    const pathPh = params.add(path.raw);
    return `JSON_UNQUOTE(JSON_EXTRACT(${columnSql}, ${pathPh})) = ${valuePlaceholder}`;
  }
  explainPrefix(): string {
    return "EXPLAIN FORMAT=JSON";
  }
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
  }
}

export const mysqlDialect = new MysqlDialect();

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
