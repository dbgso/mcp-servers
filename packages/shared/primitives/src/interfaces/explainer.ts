/**
 * Explainer primitive — cost preview without executing the query.
 * Optional; only tools with a query planner implement it.
 *
 * See docs/specs/whitelist-abstraction.md §4.6.
 */

export interface ExplainResult {
  /** null when the engine cannot estimate. */
  estimatedRows: number | null;
  /** null when the engine has no cost model. */
  totalCost: number | null;
  planSummary: string;
  raw?: unknown;
}

export interface Explainer<TQuery> {
  explain(query: TQuery): Promise<ExplainResult>;
}
