/**
 * Operation — the base contract every registered op implements.
 * Reconciles `Operation<TArgs, TCtx>` (db-vendor) and `BaseOperation`
 * (mcp-shared/core) into one shape.
 *
 * `requires.extras` / `requires.reader` let the registry validate at
 * build time that every op an adapter registers can be satisfied by
 * that adapter's declared traits.
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";

/**
 * Declaration of the trait names an op needs. The registry compares
 * this against the tool's declared trait set; mismatch = build-time
 * test failure.
 */
export interface OperationTraits {
  /**
   * Reader trait names, e.g. `["PointReader"]`, `["RangeReader"]`,
   * `["SearchReader", "MultiContainerSearchReader"]`.
   */
  reader?: readonly string[];
  /**
   * Extras trait names, e.g. `["explainer", "redactor",
   * "queryGuard"]`.
   */
  extras?: readonly string[];
}

export interface Operation<TArgs, TCtx, TResponse = unknown> {
  id: string;
  summary: string;
  detail: string;
  category?: string;

  /** Defaults to `false`. */
  mutates?: boolean;
  /** Defaults to `true`. */
  requiresAuth?: boolean;
  /**
   * `args` typed as `unknown` (rather than `TArgs`) for structural
   * compatibility with `Operation<TArgs, TCtx>` from
   * `mcp-shared-db-vendor`.
   */
  requiresApproval?: boolean | ((args: unknown) => boolean);
  approvalReason?: string;

  argsSchema: z.ZodType<TArgs>;
  validateArgs?: (args: TArgs) => TResponse | null;

  /** Trait declaration — see `OperationTraits`. */
  requires?: OperationTraits;

  execute(input: { args: TArgs; ctx: TCtx }): Promise<TResponse>;
}
