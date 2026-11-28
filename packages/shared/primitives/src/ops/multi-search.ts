/**
 * `search` op factory — the shared flow behind every tool's
 * "run a caller-supplied query language against N containers" op.
 * Covers CW Insights `query` (multi-log-group + Insights guard),
 * DDB `query` / `scan` (single-table + DDB expression guard), etc.
 *
 * Flow: pre-hooks (time-range validation etc) → merge whitelist
 *       across target containers → QueryGuard (parse + rewrite +
 *       compute redactFieldNames + enforcedLimit) → dry-run branch
 *       (if ctx.dryRun) → MultiContainerSearchReader.runMultiSearch
 *       → Redactor.redactMany with pre-computed redactFieldNames →
 *       respond.ok.
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";
import type {
  FieldWhitelist,
  MultiContainerSearchReader,
  Operation,
  QueryGuard,
  Redactor,
  ToolContext,
} from "../interfaces/index.js";
import { mergeWhitelistAcrossContainers } from "../helpers/merge-whitelist.js";

type Row = Record<string, unknown>;

/**
 * Ctx shape the factory expects. `TQueryInput` is what the guard
 * consumes (typically the raw query string plus any adapter-specific
 * knobs, e.g. `{query, strictUnknownFields}` for CW). `TSafeQuery` is
 * what the guard emits and the reader consumes.
 */
export type MultiSearchCtx<TQueryInput, TSafeQuery> = ToolContext<
  FieldWhitelist<string, string>,
  unknown,
  {
    redactor: Redactor<string, Row>;
    queryGuard: QueryGuard<TQueryInput, TSafeQuery>;
    multiContainerSearchReader: MultiContainerSearchReader<string, TSafeQuery, Row>;
  }
>;

export interface MultiMultiSearchPreHookInput<TArgs, TCtx> {
  args: TArgs;
  ctx: TCtx;
  containers: readonly string[];
}

export type MultiSearchPreHook<TArgs, TCtx, TResponse> = (
  input: MultiMultiSearchPreHookInput<TArgs, TCtx>,
) => TResponse | null | Promise<TResponse | null>;

export interface MultiSearchRespond<TArgs, TSafeQuery, TResponse> {
  ok(input: {
    args: TArgs;
    containers: readonly string[];
    safeQuery: TSafeQuery;
    redactFieldNames: ReadonlySet<string>;
    enforcedLimit: number;
    rows: readonly Row[];
    rowCount: number;
    /** Tool-specific paging / diagnostic metadata from the reader. */
    meta?: unknown;
  }): TResponse;
  containersMissing(input: {
    args: TArgs;
    containers: readonly string[];
    missing: readonly string[];
  }): TResponse;
  guardFailed(input: {
    args: TArgs;
    error: Error;
    /** Adapter-supplied error code if the thrown error carries one. */
    code?: string;
  }): TResponse;
  dryRun(input: {
    args: TArgs;
    containers: readonly string[];
    safeQuery: TSafeQuery;
    redactFieldNames: ReadonlySet<string>;
    enforcedLimit: number;
  }): TResponse;
}

export interface CreateMultiSearchOpConfig<TArgs, TCtx, TQueryInput, TSafeQuery, TResponse> {
  id?: string;
  summary?: string;
  detail?: string;
  category?: string;

  mutates?: boolean;
  requiresAuth?: boolean;
  requiresApproval?: boolean | ((args: unknown) => boolean);
  approvalReason?: string;

  argsSchema: z.ZodType<TArgs>;
  extractContainers: (args: TArgs) => readonly string[];
  extractQueryInput: (args: TArgs) => TQueryInput;

  preHooks?: readonly MultiSearchPreHook<TArgs, TCtx, TResponse>[];

  respond: MultiSearchRespond<TArgs, TSafeQuery, TResponse>;
}

export function createMultiSearchOp<
  TArgs,
  TCtx extends MultiSearchCtx<TQueryInput, TSafeQuery>,
  TQueryInput,
  TSafeQuery,
  TResponse,
>(
  config: CreateMultiSearchOpConfig<TArgs, TCtx, TQueryInput, TSafeQuery, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "search",
    summary: config.summary ?? "Run a caller-supplied query, whitelist-guarded",
    detail:
      config.detail ??
      "Parses the caller's query, applies the multi-container whitelist intersection, rewrites to a safe form, executes, and redacts.",
    category: config.category ?? "Search",
    mutates: config.mutates,
    requiresAuth: config.requiresAuth,
    requiresApproval: config.requiresApproval,
    approvalReason: config.approvalReason,
    argsSchema: config.argsSchema,
    requires: {
      reader: ["MultiContainerSearchReader"],
      extras: ["queryGuard", "redactor", "multiContainerSearchReader"],
    },
    execute: async ({ args, ctx }) => {
      const containers = config.extractContainers(args);

      for (const hook of config.preHooks ?? []) {
        const err = await hook({ args, ctx, containers });
        if (err !== null) return err;
      }

      const merged = mergeWhitelistAcrossContainers({
        whitelist: ctx.whitelist,
        containers,
      });
      if (merged.missing.length > 0) {
        return config.respond.containersMissing({
          args,
          containers,
          missing: merged.missing,
        });
      }

      const queryInput = config.extractQueryInput(args);
      let guarded;
      try {
        guarded = ctx.trait("queryGuard").guard({
          input: queryInput,
          whitelist: merged,
          limit: ctx.limit,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        return config.respond.guardFailed({
          args,
          error: err instanceof Error ? err : new Error(String(err)),
          code,
        });
      }

      if (ctx.dryRun === true) {
        return config.respond.dryRun({
          args,
          containers,
          safeQuery: guarded.safeQuery,
          redactFieldNames: guarded.redactFieldNames,
          enforcedLimit: guarded.enforcedLimit,
        });
      }

      const readerResult = await ctx.trait("multiContainerSearchReader").runMultiSearch({
        containers,
        query: guarded.safeQuery,
        limit: guarded.enforcedLimit,
      });

      const rows = ctx.trait("redactor").redactMany({
        // Use any container name for redactor keying; the field policy
        // is applied via redactFieldNames override, not per-container
        // whitelist lookup.
        container: containers[0] ?? "",
        records: readerResult.items,
        redactFieldNames: guarded.redactFieldNames,
      });

      return config.respond.ok({
        args,
        containers,
        safeQuery: guarded.safeQuery,
        redactFieldNames: guarded.redactFieldNames,
        enforcedLimit: guarded.enforcedLimit,
        rows,
        rowCount: rows.length,
        meta: readerResult.meta,
      });
    },
  };
}
