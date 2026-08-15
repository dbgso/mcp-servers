/**
 * LimitPolicy primitive — clamp a caller-supplied `limit` to a safe
 * max. One instance per tool replaces ~5 magic-number constants
 * currently sprinkled across op files.
 *
 * # Contract (clamp)
 *
 * Every `LimitPolicy.clamp` implementation MUST return an integer in
 * the closed interval `[1, maxLimit]` for every input, including
 * pathological values. Specifically:
 *
 *   - `undefined` / `NaN` / non-finite input → `defaultLimit`
 *   - `caller < 1`                            → `1`
 *   - `caller > maxLimit`                     → `maxLimit`
 *   - non-integer within range                → `Math.floor(caller)`
 *
 * Implementations should compose the `defaultClamp` helper from
 * `../helpers/default-clamp.js` — it encodes the full contract in one
 * place. Hand-rolled `Math.min(Math.max(...))` inlines have historically
 * drifted between tools (esp. NaN handling); please prefer
 * `createDefaultLimitPolicy({defaultLimit, maxLimit})`.
 *
 * Additionally, when the raw config has `defaultLimit > maxLimit`,
 * impls MUST normalise so `defaultLimit <= maxLimit` (typically by
 * capping `defaultLimit` at `maxLimit`).
 *
 * See docs/specs/whitelist-abstraction.md §4.3.
 */

export interface LimitPolicy {
  readonly defaultLimit: number;
  readonly maxLimit: number;
  /**
   * Return an integer in `[1, maxLimit]` per the contract above.
   * Impls should compose `defaultClamp({defaultLimit, maxLimit})`.
   */
  clamp(caller: number | undefined): number;
}
