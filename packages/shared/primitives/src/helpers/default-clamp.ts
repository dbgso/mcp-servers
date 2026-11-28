import type { LimitPolicy } from "../interfaces/limit-policy.js";

/**
 * Factory returning a `LimitPolicy` with the default clamp semantics.
 *
 * Contract (docs/specs/whitelist-abstraction.md "Limit clamp" +
 * interfaces/limit-policy.ts):
 *   - `undefined` / `NaN` / non-finite  → `defaultLimit`
 *   - `caller < 1`                       → `1`
 *   - `caller > maxLimit`                → `maxLimit`
 *   - non-integer within range           → `Math.floor(caller)`
 *   - result is always an integer in `[1, maxLimit]`
 *
 * `defaultLimit` is normalised to `[1, maxLimit]` (capped at `maxLimit`
 * when the raw config sets `defaultLimit > maxLimit`).
 */
export function defaultClamp(input: { defaultLimit: number; maxLimit: number }): LimitPolicy {
  const maxLimit = Math.max(1, Math.floor(input.maxLimit));
  const defaultLimit = Math.min(Math.max(1, Math.floor(input.defaultLimit)), maxLimit);

  return {
    defaultLimit,
    maxLimit,
    clamp(caller: number | undefined): number {
      if (caller === undefined || !Number.isFinite(caller)) {
        return defaultLimit;
      }
      if (caller < 1) {
        return 1;
      }
      const floored = Math.floor(caller);
      return floored > maxLimit ? maxLimit : floored;
    },
  };
}
