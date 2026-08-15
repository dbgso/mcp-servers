/**
 * `explain` op factory — cost preview for a caller-supplied query.
 * Intentionally bypasses the FieldWhitelist (Explain reveals schema;
 * DB role permissions are the boundary, not row-data ACL —
 * documented in the interface catalog §4.6).
 *
 * Flow: input-guard (SELECT-only / DDL reject / SLEEP reject / etc)
 *       → Explainer.explain(query) → respond.ok (with optional
 *       verbose branch for raw plan).
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";
import type {
  ExplainResult,
  Explainer,
  Operation,
  ToolContext,
  Whitelist,
} from "../interfaces/index.js";

/**
 * Ctx shape: `explainer` is required; whitelist is present (all
 * ctxs have one) but intentionally NOT consulted.
 */
export type ExplainCtx<TQuery> = ToolContext<
  Whitelist<string>,
  unknown,
  { explainer: Explainer<TQuery> }
>;

/**
 * Guard fn: throws / returns an error response when the input query
 * shouldn't be planned. Called BEFORE the Explainer.
 */
export type ExplainInputGuard<TArgs, TCtx, TQuery, TResponse> = (input: {
  args: TArgs;
  ctx: TCtx;
  query: TQuery;
}) => TResponse | null | Promise<TResponse | null>;

export interface ExplainRespond<TArgs, TResponse> {
  ok(input: { args: TArgs; result: ExplainResult; verbose: boolean }): TResponse;
  invalidQuery(input: { args: TArgs; message: string }): TResponse;
}

export interface CreateExplainOpConfig<TArgs, TCtx, TQuery, TResponse> {
  id?: string;
  summary?: string;
  detail?: string;
  category?: string;

  argsSchema: z.ZodType<TArgs>;
  /** Build the concrete `TQuery` from args (e.g. `{sql, params}`). */
  extractQuery: (args: TArgs) => TQuery;
  /** Optional: extract verbose flag. Default: false. */
  extractVerbose?: (args: TArgs) => boolean;

  /**
   * Ordered pre-execute guards. First non-null response short-circuits.
   * Typical guard: assertSelectOnly for SQL, or a token-parser
   * (guardInsightsQuery) for CW.
   */
  guards?: readonly ExplainInputGuard<TArgs, TCtx, TQuery, TResponse>[];

  respond: ExplainRespond<TArgs, TResponse>;
}

export function createExplainOp<TArgs, TCtx extends ExplainCtx<TQuery>, TQuery, TResponse>(
  config: CreateExplainOpConfig<TArgs, TCtx, TQuery, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "explain",
    summary: config.summary ?? "Cost preview of a query without executing it",
    detail:
      config.detail ??
      "Runs the engine's EXPLAIN primitive against the caller-supplied query. Bypasses whitelist by design — the DB role's SELECT permissions are the real boundary.",
    category: config.category ?? "Discovery",
    argsSchema: config.argsSchema,
    requires: {
      extras: ["explainer"],
    },
    execute: async ({ args, ctx }) => {
      const query = config.extractQuery(args);
      const verbose = config.extractVerbose?.(args) ?? false;

      for (const guard of config.guards ?? []) {
        const err = await guard({ args, ctx, query });
        if (err !== null) return err;
      }

      const result = await ctx.trait("explainer").explain(query);
      return config.respond.ok({ args, result, verbose });
    },
  };
}
