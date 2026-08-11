/**
 * Helpers for checking whether a column has an index that can drive a single
 * lookup. Used by read ops to surface a warning when a query is going to
 * scan rows the planner cannot narrow with an index.
 *
 * The check is intentionally conservative: it only confirms the LEADING
 * field of a known index, since trailing keys of a composite index cannot
 * be used in isolation. The primary key counts as a leading index.
 *
 * Distinguish two metadata states deliberately:
 *   - `indexes: undefined` (hand-written fixtures, older introspectors)
 *     → silence the warning. We can't prove the column is un-indexed.
 *   - `indexes: []` (introspected: zero indexes) → warn for any non-PK
 *     column. The codegen always emits the explicit empty array.
 */
import type { RdbTableMetadata } from "./rdb-metadata.js";

type IndexedMeta = Pick<RdbTableMetadata, "primaryKey" | "indexes">;

export interface HasLeadingIndexParams {
  meta: IndexedMeta;
  column: string;
}

export function hasLeadingIndex(params: HasLeadingIndexParams): boolean {
  const { meta, column } = params;
  if (meta.primaryKey?.[0] === column) return true;
  if (meta.indexes === undefined) return true;
  return meta.indexes.some((ix) => ix.fields[0] === column);
}

export interface UnindexedColumnWarningParams {
  table: string;
  column: string;
}

export function unindexedColumnWarning(params: UnindexedColumnWarningParams): string {
  const { table, column } = params;
  return (
    `Column '${column}' on '${table}' has no leading index. The query will ` +
    `still run, but may scan the whole table — add an index, or rely on the ` +
    `session statement_timeout to bound runtime.`
  );
}
