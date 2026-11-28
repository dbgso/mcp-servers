/**
 * QueryGuard primitive — parse a caller-supplied query language,
 * apply the whitelist, rewrite into a safe form, compute the redact
 * set. Executed BEFORE any backend call.
 *
 * See docs/specs/whitelist-abstraction.md §4.5.
 */

import type { LimitPolicy } from "./limit-policy.js";

export interface QueryGuardWhitelist {
  readonly allowed: readonly string[];
  readonly excluded: readonly string[];
  readonly redacted: readonly string[];
}

export interface QueryGuardResult<TSafeQuery> {
  safeQuery: TSafeQuery;
  /**
   * Fields the reader response MUST have redacted before it reaches
   * the caller. Marked as a `GuardedRedactSet` (branded) so consumers
   * of `Redactor.redactMany({..., redactFieldNames})` can only pass a
   * value produced by a `QueryGuard.guard(...)` call.
   *
   * See `Redactor.redactMany` contract on how this override is used.
   */
  redactFieldNames: GuardedRedactSet;
  /**
   * The `limit` value the reader MUST use. Implementations MUST run
   * the caller-supplied limit through `LimitPolicy.clamp` (or the
   * shared `defaultClamp` helper) so this value is guaranteed to
   * satisfy the `LimitPolicy` contract: an integer in
   * `[1, LimitPolicy.maxLimit]`.
   */
  enforcedLimit: number;
}

/**
 * Branded type produced only by `QueryGuard.guard()`. Prevents
 * upstream callers from fabricating a `redactFieldNames` override that
 * bypasses per-container whitelist redact policy — the branded
 * `Redactor.redactOne/redactMany` override argument accepts only this
 * type, so the only way to obtain one is through the guard.
 *
 * Structurally it is a `ReadonlySet<string>`; the brand is erased at
 * runtime and enforced only at compile time. The `asGuardedRedactSet`
 * helper below is exposed so `QueryGuard` impls can produce values of
 * this type without ceremony; downstream code SHOULD NOT call it.
 */
export type GuardedRedactSet = ReadonlySet<string> & { readonly __brand: "GuardedRedactSet" };

/**
 * Escape hatch for `QueryGuard.guard(...)` implementers to brand a
 * plain `ReadonlySet<string>` as a `GuardedRedactSet`. Downstream
 * callers (op executors, redactor consumers) MUST NOT call this — the
 * brand's purpose is to force redact overrides to originate in a
 * guard. Runtime is a no-op cast.
 */
export function asGuardedRedactSet(set: ReadonlySet<string>): GuardedRedactSet {
  return set as GuardedRedactSet;
}

export interface QueryGuard<TInput, TSafeQuery> {
  /**
   * Reference implementations:
   * - CW v2 Insights: `aws/src/cloudwatch/insights-guard/query-guard.ts:guardInsightsQuery`
   *   — full tokeniser + reference check + LIMIT rewrite.
   * - DB SQL: `db-ops/src/sql-guard.ts:assertSelectOnly` — degenerate
   *   (`TSafeQuery = string` unchanged; throws on DDL / OUTFILE /
   *   SLEEP / multi-statement).
   */
  guard(input: {
    input: TInput;
    whitelist: QueryGuardWhitelist;
    limit: LimitPolicy;
  }): QueryGuardResult<TSafeQuery>;
}
