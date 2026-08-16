/**
 * `find_by_eq` op factory — the shared flow behind every tool's
 * "fetch N items by a single equality predicate on a whitelisted
 * field" op. Covers RDB `get_by_fk` / `get_by_index` (both were
 * byte-identical modulo id + labels), DDB GSI queries with a single
 * partition key, Redis hash lookup by field value, etc.
 *
 * Flow: whitelist gate → empty-fields gate → field-in-whitelist gate
 *       → pre-hooks → limit clamp → reader.readByEq → redact →
 *       respond.ok (with optional post-hook that enriches the response,
 *       e.g. "warning: column is not indexed").
 *
 * See docs/specs/whitelist-abstraction.md (op factories) §6.
 */

import type { z } from "zod";
import type {
  EqReader,
  FieldWhitelist,
  LimitPolicy,
  Operation,
  Redactor,
  ToolContext,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;

/**
 * The trait shape the factory expects on ctx. Tools' concrete `TCtx`
 * must extend this.
 */
export type FindByEqCtx = ToolContext<
  FieldWhitelist<string, string>,
  unknown,
  {
    redactor: Redactor<string, Row>;
    eqReader: EqReader<string, Row>;
  }
> & { limit: LimitPolicy };

export interface FindByEqPreHookInput<TArgs, TCtx> {
  args: TArgs;
  ctx: TCtx;
  container: string;
  field: string;
  value: unknown;
}

/** Return a response to short-circuit; return null to continue. */
export type FindByEqPreHook<TArgs, TCtx, TResponse> = (
  input: FindByEqPreHookInput<TArgs, TCtx>,
) => TResponse | null | Promise<TResponse | null>;

/** Optional post-hook to enrich response.ok payload (e.g. unindexed warning). */
export type FindByEqPostHook<TArgs, TCtx> = (input: {
  args: TArgs;
  ctx: TCtx;
  container: string;
  field: string;
  value: unknown;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface FindByEqRespond<TArgs, TResponse> {
  ok(input: {
    args: TArgs;
    container: string;
    field: string;
    value: unknown;
    rows: readonly Row[];
    count: number;
    /** Extra fields merged into the ok response (from post-hook). */
    extra: Record<string, unknown>;
  }): TResponse;
  notFound(input: { args: TArgs; container: string; field: string; value: unknown }): TResponse;
  notWhitelisted(input: {
    args: TArgs;
    container: string;
    available: readonly string[];
  }): TResponse;
  emptyWhitelist(input: { args: TArgs; container: string }): TResponse;
  fieldNotSelectable(input: {
    args: TArgs;
    container: string;
    field: string;
    allowedFields: readonly string[];
  }): TResponse;
}

export interface CreateFindByEqOpConfig<TArgs, TCtx, TResponse> {
  id?: string;
  summary?: string;
  detail?: string;
  category?: string;

  argsSchema: z.ZodType<TArgs>;
  extractContainer: (args: TArgs) => string;
  extractField: (args: TArgs) => string;
  extractValue: (args: TArgs) => unknown;
  extractLimit?: (args: TArgs) => number | undefined;

  preHooks?: readonly FindByEqPreHook<TArgs, TCtx, TResponse>[];
  /** Runs on the ok path only; result merged into response payload. */
  postHook?: FindByEqPostHook<TArgs, TCtx>;

  respond: FindByEqRespond<TArgs, TResponse>;
}

export function createFindByEqOp<TArgs, TCtx extends FindByEqCtx, TResponse>(
  config: CreateFindByEqOpConfig<TArgs, TCtx, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "get_by_eq",
    summary: config.summary ?? "Fetch rows by an equality predicate on a whitelisted field",
    detail:
      config.detail ??
      "Filter rows by a single-field equality predicate. Whitelist-guarded; PII fields are redacted per the container's field policy.",
    category: config.category ?? "Read",
    argsSchema: config.argsSchema,
    requires: {
      extras: ["redactor", "eqReader"],
    },
    execute: async ({ args, ctx }) => {
      const container = config.extractContainer(args);
      const field = config.extractField(args);
      const value = config.extractValue(args);

      // Guard 1: container in whitelist.
      if (!ctx.whitelist.hasContainer(container)) {
        return config.respond.notWhitelisted({
          args,
          container,
          available: ctx.whitelist.listContainers(),
        });
      }

      // Guard 2: closed-by-default.
      if (ctx.whitelist.isEmpty(container)) {
        return config.respond.emptyWhitelist({ args, container });
      }

      // Guard 3: predicate field in whitelist.
      const allowedFields = ctx.whitelist.getSelectableFields(container);
      if (!allowedFields.includes(field)) {
        return config.respond.fieldNotSelectable({
          args,
          container,
          field,
          allowedFields,
        });
      }

      // Guard 4: tool-specific pre-hooks.
      for (const hook of config.preHooks ?? []) {
        const err = await hook({ args, ctx, container, field, value });
        if (err !== null) return err;
      }

      const limit = ctx.limit.clamp(config.extractLimit?.(args));
      const rawRows = await ctx.trait("eqReader").readByEq({
        container,
        field,
        value,
        fields: allowedFields,
        limit,
      });

      const rows = ctx.trait("redactor").redactMany({ container, records: rawRows });
      const extra = (await config.postHook?.({ args, ctx, container, field, value })) ?? {};

      return config.respond.ok({
        args,
        container,
        field,
        value,
        rows,
        count: rows.length,
        extra,
      });
    },
  };
}
