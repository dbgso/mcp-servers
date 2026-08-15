/**
 * `search` op factory (single-container) — the shared flow behind
 * every tool's "run a caller-supplied query against ONE container"
 * op. Covers DDB `query` / `scan` (table-scoped), Redis SCAN
 * (pattern-scoped), etc. Multi-container search (CW Insights across
 * N log groups) uses `createMultiSearchOp` in `./multi-search.js`.
 *
 * Flow: pre-hooks → QueryGuard (parse + rewrite + compute
 *       redactFieldNames + enforcedLimit) → dry-run branch (if
 *       ctx.dryRun) → SearchReader.runSearch → Redactor.redactMany
 *       with pre-computed redactFieldNames → respond.ok.
 *
 * Unlike `createMultiSearchOp`, this factory does NOT merge whitelist
 * across containers (there's only one). The caller passes the merged
 * whitelist directly (usually the FieldWhitelist's per-container
 * lookup) to the guard.
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";
import type {
  FieldWhitelist,
  Operation,
  QueryGuard,
  Redactor,
  SearchReader,
  ToolContext,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;

/**
 * Ctx shape the factory expects. `TQueryInput` is what the guard
 * consumes; `TSafeQuery` is what the guard emits and the reader
 * consumes.
 */
export type SearchCtx<TQueryInput, TSafeQuery> = ToolContext<
  FieldWhitelist<string, string>,
  unknown,
  {
    redactor: Redactor<string, Row>;
    queryGuard: QueryGuard<TQueryInput, TSafeQuery>;
    searchReader: SearchReader<string, TSafeQuery, Row>;
  }
>;

export interface SearchPreHookInput<TArgs, TCtx> {
  args: TArgs;
  ctx: TCtx;
  container: string;
}

export type SearchPreHook<TArgs, TCtx, TResponse> = (
  input: SearchPreHookInput<TArgs, TCtx>,
) => TResponse | null | Promise<TResponse | null>;

export interface SearchRespond<TArgs, TSafeQuery, TResponse> {
  ok(input: {
    args: TArgs;
    container: string;
    safeQuery: TSafeQuery;
    redactFieldNames: ReadonlySet<string>;
    enforcedLimit: number;
    rows: readonly Row[];
    rowCount: number;
    /** Tool-specific paging / diagnostic metadata from the reader. */
    meta?: unknown;
  }): TResponse;
  notWhitelisted(input: {
    args: TArgs;
    container: string;
    available: readonly string[];
  }): TResponse;
  emptyWhitelist(input: { args: TArgs; container: string }): TResponse;
  guardFailed(input: { args: TArgs; error: Error; code?: string }): TResponse;
  dryRun(input: {
    args: TArgs;
    container: string;
    safeQuery: TSafeQuery;
    redactFieldNames: ReadonlySet<string>;
    enforcedLimit: number;
  }): TResponse;
}

export interface CreateSearchOpConfig<TArgs, TCtx, TQueryInput, TSafeQuery, TResponse> {
  id?: string;
  summary?: string;
  detail?: string;
  category?: string;

  mutates?: boolean;
  requiresAuth?: boolean;
  requiresApproval?: boolean | ((args: unknown) => boolean);
  approvalReason?: string;

  argsSchema: z.ZodType<TArgs>;
  extractContainer: (args: TArgs) => string;
  extractQueryInput: (args: TArgs) => TQueryInput;

  preHooks?: readonly SearchPreHook<TArgs, TCtx, TResponse>[];

  respond: SearchRespond<TArgs, TSafeQuery, TResponse>;
}

export function createSearchOp<
  TArgs,
  TCtx extends SearchCtx<TQueryInput, TSafeQuery>,
  TQueryInput,
  TSafeQuery,
  TResponse,
>(
  config: CreateSearchOpConfig<TArgs, TCtx, TQueryInput, TSafeQuery, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "search",
    summary: config.summary ?? "Run a caller-supplied query against one container",
    detail:
      config.detail ??
      "Parses the caller's query, applies the container's whitelist, rewrites to a safe form, executes, and redacts.",
    category: config.category ?? "Search",
    mutates: config.mutates,
    requiresAuth: config.requiresAuth,
    requiresApproval: config.requiresApproval,
    approvalReason: config.approvalReason,
    argsSchema: config.argsSchema,
    requires: {
      reader: ["SearchReader"],
      extras: ["queryGuard", "redactor", "searchReader"],
    },
    execute: async ({ args, ctx }) => {
      const container = config.extractContainer(args);

      if (!ctx.whitelist.hasContainer(container)) {
        return config.respond.notWhitelisted({
          args,
          container,
          available: ctx.whitelist.listContainers(),
        });
      }
      if (ctx.whitelist.isEmpty(container)) {
        return config.respond.emptyWhitelist({ args, container });
      }

      for (const hook of config.preHooks ?? []) {
        const err = await hook({ args, ctx, container });
        if (err !== null) return err;
      }

      // Derive single-container whitelist for the guard.
      const cfg = ctx.whitelist.getContainer(container);
      const allowed: string[] = [];
      const excluded: string[] = [];
      const redacted: string[] = [];
      if (cfg) {
        for (const [name, info] of Object.entries(cfg.fields) as Iterable<
          [string, { select?: "expose" | "redact" | "exclude" }]
        >) {
          const policy = info.select ?? "redact";
          if (policy === "exclude") {
            excluded.push(name);
          } else {
            allowed.push(name);
            if (policy === "redact") redacted.push(name);
          }
        }
      }

      const queryInput = config.extractQueryInput(args);
      let guarded;
      try {
        guarded = ctx.trait("queryGuard").guard({
          input: queryInput,
          whitelist: { allowed, excluded, redacted },
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
          container,
          safeQuery: guarded.safeQuery,
          redactFieldNames: guarded.redactFieldNames,
          enforcedLimit: guarded.enforcedLimit,
        });
      }

      const readerResult = await ctx.trait("searchReader").runSearch({
        container,
        query: guarded.safeQuery,
        limit: guarded.enforcedLimit,
      });

      const rows = ctx.trait("redactor").redactMany({
        container,
        records: readerResult.items,
        redactFieldNames: guarded.redactFieldNames,
      });

      return config.respond.ok({
        args,
        container,
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
