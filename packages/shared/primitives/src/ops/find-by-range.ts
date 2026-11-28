/**
 * `find_by_range` op factory — the shared flow behind every tool's
 * "fetch N items in a bounded range on a whitelisted field" op.
 * Covers RDB `get_by_date_range` (with EXPLAIN gate), Redis `lrange` /
 * `zrange` (index bounds; no explain).
 *
 * Flow: whitelist / empty-fields / field-in-whitelist gates →
 *       pre-hooks (type + range validation) → optional Explain gate
 *       (block if estimate > threshold unless bypass) → limit clamp →
 *       reader.readByRange → redact → respond.ok (with postHook
 *       extras: warning + estimate + planSummary).
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";
import type {
  ExplainResult,
  Explainer,
  FieldWhitelist,
  LimitPolicy,
  Operation,
  RangeReader,
  Redactor,
  ToolContext,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;

/** Ctx shape the factory expects. TBound is generic (Date / number / ...). */
export type FindByRangeCtx<TBound> = ToolContext<
  FieldWhitelist<string, string>,
  unknown,
  {
    redactor: Redactor<string, Row>;
    rangeReader: RangeReader<string, TBound, Row>;
    /**
     * Optional. When present AND `config.explainThreshold` is set, the
     * factory runs Explain before the range read and blocks when the
     * estimate exceeds the threshold.
     */
    rangeExplainer?: Explainer<{
      container: string;
      field: string;
      from: TBound;
      to: TBound;
      fields: readonly string[];
      limit: number;
    }>;
  }
> & { limit: LimitPolicy };

export interface FindByRangePreHookInput<TArgs, TCtx, TBound> {
  args: TArgs;
  ctx: TCtx;
  container: string;
  field: string;
  from: TBound;
  to: TBound;
}

export type FindByRangePreHook<TArgs, TCtx, TBound, TResponse> = (
  input: FindByRangePreHookInput<TArgs, TCtx, TBound>,
) => TResponse | null | Promise<TResponse | null>;

export type FindByRangePostHook<TArgs, TCtx, TBound> = (input: {
  args: TArgs;
  ctx: TCtx;
  container: string;
  field: string;
  from: TBound;
  to: TBound;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface FindByRangeRespond<TArgs, TBound, TResponse> {
  ok(input: {
    args: TArgs;
    container: string;
    field: string;
    from: TBound;
    to: TBound;
    rows: readonly Row[];
    count: number;
    /** Included when the factory ran Explain (config.explainThreshold set). */
    estimate?: ExplainResult;
    extra: Record<string, unknown>;
  }): TResponse;
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
  /**
   * Called when the Explain estimate exceeds the threshold and the
   * caller did not bypass. Only invoked when explainThreshold is set.
   */
  blockedByExplain?(input: {
    args: TArgs;
    container: string;
    field: string;
    from: TBound;
    to: TBound;
    estimate: ExplainResult;
    threshold: number;
    extra: Record<string, unknown>;
  }): TResponse;
}

export interface CreateFindByRangeOpConfig<TArgs, TCtx, TBound, TResponse> {
  id?: string;
  summary?: string;
  detail?: string;
  category?: string;

  argsSchema: z.ZodType<TArgs>;
  extractContainer: (args: TArgs) => string;
  extractField: (args: TArgs) => string;
  extractFrom: (args: TArgs) => TBound;
  extractTo: (args: TArgs) => TBound;
  extractLimit?: (args: TArgs) => number | undefined;
  /** When true, factory skips the Explain gate. */
  extractBypassExplain?: (args: TArgs) => boolean;

  preHooks?: readonly FindByRangePreHook<TArgs, TCtx, TBound, TResponse>[];
  postHook?: FindByRangePostHook<TArgs, TCtx, TBound>;

  /**
   * When set (either a fixed number or a per-args function), factory
   * runs Explain first via `ctx.trait("rangeExplainer")`. If the
   * estimate exceeds the threshold AND `extractBypassExplain(args) !==
   * true`, calls `respond.blockedByExplain(...)` (must be provided).
   * If unset, no Explain runs.
   */
  explainThreshold?: number | ((args: TArgs) => number);

  respond: FindByRangeRespond<TArgs, TBound, TResponse>;
}

export function createFindByRangeOp<TArgs, TCtx extends FindByRangeCtx<TBound>, TBound, TResponse>(
  config: CreateFindByRangeOpConfig<TArgs, TCtx, TBound, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "get_by_range",
    summary: config.summary ?? "Fetch rows whose field falls within a bounded range",
    detail:
      config.detail ??
      "Range predicate on a whitelisted field. Whitelist-guarded; optionally EXPLAIN-gated.",
    category: config.category ?? "Read",
    argsSchema: config.argsSchema,
    requires: {
      extras: config.explainThreshold
        ? ["redactor", "rangeReader", "rangeExplainer"]
        : ["redactor", "rangeReader"],
    },
    execute: async ({ args, ctx }) => {
      const container = config.extractContainer(args);
      const field = config.extractField(args);
      const from = config.extractFrom(args);
      const to = config.extractTo(args);

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
      const allowedFields = ctx.whitelist.getSelectableFields(container);
      if (!allowedFields.includes(field)) {
        return config.respond.fieldNotSelectable({
          args,
          container,
          field,
          allowedFields,
        });
      }
      for (const hook of config.preHooks ?? []) {
        const err = await hook({ args, ctx, container, field, from, to });
        if (err !== null) return err;
      }

      const limit = ctx.limit.clamp(config.extractLimit?.(args));

      // Optional EXPLAIN gate.
      let estimate: ExplainResult | undefined;
      if (config.explainThreshold !== undefined) {
        const explainer = ctx.trait("rangeExplainer");
        if (!explainer) {
          throw new Error(
            "createFindByRangeOp: config.explainThreshold set but ctx.trait('rangeExplainer') is missing.",
          );
        }
        estimate = await explainer.explain({
          container,
          field,
          from,
          to,
          fields: allowedFields,
          limit,
        });
        const threshold =
          typeof config.explainThreshold === "function"
            ? config.explainThreshold(args)
            : config.explainThreshold;
        const bypass = config.extractBypassExplain?.(args) === true;
        if (!bypass && estimate.estimatedRows !== null && estimate.estimatedRows > threshold) {
          if (!config.respond.blockedByExplain) {
            throw new Error(
              "createFindByRangeOp: explainThreshold triggered blockedByExplain but respond.blockedByExplain is not defined.",
            );
          }
          const extra = (await config.postHook?.({ args, ctx, container, field, from, to })) ?? {};
          return config.respond.blockedByExplain({
            args,
            container,
            field,
            from,
            to,
            estimate,
            threshold,
            extra,
          });
        }
      }

      const rawRows = await ctx.trait("rangeReader").readByRange({
        container,
        field,
        from,
        to,
        fields: allowedFields,
        limit,
      });
      const rows = ctx.trait("redactor").redactMany({ container, records: rawRows });
      const extra = (await config.postHook?.({ args, ctx, container, field, from, to })) ?? {};

      return config.respond.ok({
        args,
        container,
        field,
        from,
        to,
        rows,
        count: rows.length,
        estimate,
        extra,
      });
    },
  };
}
