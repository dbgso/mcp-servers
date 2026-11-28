/**
 * Redactor primitive — response post-filter. Applies per-field
 * expose/redact/exclude policy to a record.
 *
 * # `redactFieldNames` override contract
 *
 * The optional `redactFieldNames` override lets a `QueryGuard`
 * pre-compute the redact set at parse time (so multi-container
 * searches don't re-derive it per record). To ensure the override
 * can NEVER bypass whitelist policy by accident, its type is
 * `GuardedRedactSet` — a branded `ReadonlySet<string>` that only
 * `QueryGuard.guard(...)` can produce.
 *
 * If a consumer doesn't have a guard result to hand (e.g. a
 * point-read op), omit the override; the redactor MUST fall back to
 * per-container whitelist lookup.
 *
 * See docs/specs/whitelist-abstraction.md §4.2
 * and §4.5.
 */

import type { GuardedRedactSet } from "./query-guard.js";

export interface Redactor<TContainer extends string, TRecord> {
  redactOne(input: {
    container: TContainer;
    record: TRecord;
    /**
     * Optional pre-computed override — MUST originate from a
     * `QueryGuard.guard(...)` call (enforced by the `GuardedRedactSet`
     * brand). When omitted, the redactor falls back to per-container
     * whitelist policy lookup.
     */
    redactFieldNames?: GuardedRedactSet;
  }): TRecord;

  redactMany(input: {
    container: TContainer;
    records: readonly TRecord[];
    redactFieldNames?: GuardedRedactSet;
  }): TRecord[];
}
