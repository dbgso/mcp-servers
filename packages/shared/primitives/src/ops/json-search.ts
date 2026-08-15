/**
 * `json_search` op factory — search rows by exact-match on a JSON
 * path within a whitelisted field. Currently RDB-only; kept as a
 * distinct factory (not a variant of createFindByEqOp) because the
 * `path` extra parameter and the path-normalization / injection guard
 * are semantically separate concerns.
 *
 * Flow: whitelist / empty / field-in-whitelist gates → pre-hooks
 *       (type == "json", metadata existence) → path normalization
 *       (tool-supplied via extractPath — factory doesn't touch the
 *       injection guard, which lives in the tool's argsSchema
 *       .refine) → limit clamp → reader.readByJsonPath → redact →
 *       respond.ok (with postHook extras: unindexed warning).
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";
import type {
  FieldWhitelist,
  JsonPathReader,
  LimitPolicy,
  Operation,
  Redactor,
  ToolContext,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;

export type JsonSearchCtx = ToolContext<
  FieldWhitelist<string, string>,
  unknown,
  {
    redactor: Redactor<string, Row>;
    jsonPathReader: JsonPathReader<string, Row>;
  }
> & { limit: LimitPolicy };

export interface JsonSearchPreHookInput<TArgs, TCtx> {
  args: TArgs;
  ctx: TCtx;
  container: string;
  field: string;
  path: string;
  value: unknown;
}

export type JsonSearchPreHook<TArgs, TCtx, TResponse> = (
  input: JsonSearchPreHookInput<TArgs, TCtx>,
) => TResponse | null | Promise<TResponse | null>;

export type JsonSearchPostHook<TArgs, TCtx> = (input: {
  args: TArgs;
  ctx: TCtx;
  container: string;
  field: string;
  path: string;
  value: unknown;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface JsonSearchRespond<TArgs, TResponse> {
  ok(input: {
    args: TArgs;
    container: string;
    field: string;
    path: string;
    value: unknown;
    rows: readonly Row[];
    count: number;
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
}

export interface CreateJsonSearchOpConfig<TArgs, TCtx, TResponse> {
  id?: string;
  summary?: string;
  detail?: string;
  category?: string;

  argsSchema: z.ZodType<TArgs>;
  extractContainer: (args: TArgs) => string;
  extractField: (args: TArgs) => string;
  /** Return the JSON path (already normalized to `$.foo.bar` form). */
  extractPath: (args: TArgs) => string;
  extractValue: (args: TArgs) => unknown;
  extractLimit?: (args: TArgs) => number | undefined;

  preHooks?: readonly JsonSearchPreHook<TArgs, TCtx, TResponse>[];
  postHook?: JsonSearchPostHook<TArgs, TCtx>;

  respond: JsonSearchRespond<TArgs, TResponse>;
}

export function createJsonSearchOp<TArgs, TCtx extends JsonSearchCtx, TResponse>(
  config: CreateJsonSearchOpConfig<TArgs, TCtx, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "json_search",
    summary: config.summary ?? "Search rows by exact match on a JSON path",
    detail:
      config.detail ??
      "Filter rows where the JSON value at `<path>` in `<field>` equals `<value>`. Whitelist-guarded.",
    category: config.category ?? "Read",
    argsSchema: config.argsSchema,
    requires: {
      extras: ["redactor", "jsonPathReader"],
    },
    execute: async ({ args, ctx }) => {
      const container = config.extractContainer(args);
      const field = config.extractField(args);
      const path = config.extractPath(args);
      const value = config.extractValue(args);

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
        const err = await hook({ args, ctx, container, field, path, value });
        if (err !== null) return err;
      }

      const limit = ctx.limit.clamp(config.extractLimit?.(args));
      const rawRows = await ctx.trait("jsonPathReader").readByJsonPath({
        container,
        field,
        path,
        value,
        fields: allowedFields,
        limit,
      });
      const rows = ctx.trait("redactor").redactMany({ container, records: rawRows });
      const extra = (await config.postHook?.({ args, ctx, container, field, path, value })) ?? {};

      return config.respond.ok({
        args,
        container,
        field,
        path,
        value,
        rows,
        count: rows.length,
        extra,
      });
    },
  };
}
