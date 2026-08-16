/**
 * Reader traits — the actual backend calls. Split by predicate shape.
 * A tool implements the subset that matches its backend's
 * capabilities; the trait accessor on `ToolContext` throws
 * `UnsupportedOperationError` for absent traits.
 *
 * See docs/specs/whitelist-abstraction.md §4.7.
 */

export interface PointReader<TContainer, TKey, TRecord> {
  readOne(input: {
    container: TContainer;
    key: TKey;
    fields: readonly string[];
  }): Promise<TRecord | null>;
}

export interface EqReader<TContainer, TRecord> {
  readByEq(input: {
    container: TContainer;
    field: string;
    value: unknown;
    fields: readonly string[];
    limit: number;
  }): Promise<TRecord[]>;
}

export interface RangeReader<TContainer, TBound, TRecord> {
  readByRange(input: {
    container: TContainer;
    field: string;
    from: TBound;
    to: TBound;
    fields: readonly string[];
    limit: number;
  }): Promise<TRecord[]>;
}

/**
 * Search result envelope. `items` is the row payload; `meta` carries
 * tool-specific paging / diagnostic metadata (DDB `lastEvaluatedKey`
 * / CW `nextToken` / Redis `cursor` / ...) opaque to the primitive
 * layer. Op-side respond mappers cast `meta` to their adapter's
 * concrete type.
 */
export interface SearchResult<TRecord> {
  items: TRecord[];
  meta?: unknown;
}

export interface SearchReader<TContainer, TSafeQuery, TRecord> {
  runSearch(input: {
    container: TContainer;
    query: TSafeQuery;
    limit: number;
  }): Promise<SearchResult<TRecord>>;
}

/**
 * CW-only today: Insights allows one query to span multiple log
 * groups. Single-container tools do NOT implement this.
 */
export interface MultiContainerSearchReader<TContainer, TSafeQuery, TRecord> extends SearchReader<
  TContainer,
  TSafeQuery,
  TRecord
> {
  runMultiSearch(input: {
    containers: readonly TContainer[];
    query: TSafeQuery;
    limit: number;
  }): Promise<SearchResult<TRecord>>;
}

/**
 * Enumerator response envelope. `items` is the identifier list;
 * `nextCursor` is opaque paging state; `meta` carries tool-specific
 * paging / diagnostic metadata (S3 `isTruncated` + object metadata,
 * Redis SCAN `cursor` typing, ...) opaque to the primitive layer. Op
 * respond mappers cast `meta` to their adapter's concrete type.
 *
 * Mirrors `SearchResult<TRecord>.meta` from the SearchReader contract
 * (readers.ts §above) so single- and multi-page reader envelopes have
 * matching shape.
 */
export interface EnumeratePage<TIdentifier> {
  items: readonly TIdentifier[];
  nextCursor?: string;
  meta?: unknown;
}

export interface Enumerator<TContainer, TIdentifier> {
  /**
   * Server-side enumerator for containers where identifiers are
   * unbounded (S3 objects, Redis SCAN). `filter` is caller-supplied;
   * op layer must enforce that it overlaps the whitelist before
   * calling.
   */
  enumerate(input: {
    container: TContainer;
    filter: { prefix?: string; match?: string };
    cursor?: string;
    limit: number;
  }): Promise<EnumeratePage<TIdentifier>>;
}
