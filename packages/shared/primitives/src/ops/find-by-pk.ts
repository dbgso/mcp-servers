/**
 * `find_by_pk` op factory — owns the flow, delegates I/O and
 * tool-specific policy to the caller.
 *
 * Every tool that ships a "read one item by exact key" op calls this
 * factory with:
 *   - argsSchema         — tool-specific arg shape (`{table,pk}` /
 *                          `{tableName,key}` / `{key}` ...)
 *   - extractContainer / extractKey — pull the primitive-shaped
 *                          inputs from the tool's args
 *   - preHooks           — tool-specific pre-execute checks
 *                          (composite-PK reject, hash-type check, ...)
 *   - respond            — response-shape mapper (labels differ per
 *                          tool: `{table, pk, found}` vs
 *                          `{tableName, key, found}` etc)
 *
 * The flow itself (whitelist gate → empty-fields gate → pre-hooks →
 * read → redact → respond) lives here, once.
 *
 * `TKey` is generic to accommodate scalar PKs (RDB: string | number)
 * and composite/opaque keys (DDB: {pk, sk} shaped Record). Default is
 * `string | number` for backward-compat with existing RDB callers.
 *
 * See docs/specs/whitelist-abstraction.md (op factories).
 */

import type { z } from "zod";
import type {
  FieldWhitelist,
  Operation,
  PointReader,
  Redactor,
  ToolContext,
} from "../interfaces/index.js";

type Row = Record<string, unknown>;

/**
 * The trait shape the factory expects on ctx. Tools' concrete `TCtx`
 * types must extend this. `TKey` defaults to `string | number` for
 * simple scalar PKs; DDB and similar pass their own key type
 * (e.g. `Record<string, unknown>` for composite keys).
 */
export type FindByPkCtx<TKey = string | number> = ToolContext<
  FieldWhitelist<string, string>,
  PointReader<string, TKey, Row>,
  { redactor: Redactor<string, Row> }
>;

export interface FindByPkPreHookInput<TArgs, TCtx, TKey> {
  args: TArgs;
  ctx: TCtx;
  container: string;
  key: TKey;
}

/**
 * Return a response to short-circuit; return `null` to continue. Async
 * hooks are supported so a hook can consult an external system.
 */
export type FindByPkPreHook<TArgs, TCtx, TKey, TResponse> = (
  input: FindByPkPreHookInput<TArgs, TCtx, TKey>,
) => TResponse | null | Promise<TResponse | null>;

export interface FindByPkRespond<TArgs, TKey, TResponse> {
  ok(input: { args: TArgs; container: string; key: TKey; row: Row }): TResponse;
  notFound(input: { args: TArgs; container: string; key: TKey }): TResponse;
  notWhitelisted(input: {
    args: TArgs;
    container: string;
    available: readonly string[];
  }): TResponse;
  emptyWhitelist(input: { args: TArgs; container: string }): TResponse;
}

export interface CreateFindByPkOpConfig<TArgs, TCtx, TKey, TResponse> {
  /** Defaults to `"get_by_pk"`. */
  id?: string;
  /** Defaults to `"Fetch a single row by primary key"`. */
  summary?: string;
  detail?: string;
  /** Defaults to `"Read"`. */
  category?: string;

  argsSchema: z.ZodType<TArgs>;
  extractContainer: (args: TArgs) => string;
  extractKey: (args: TArgs) => TKey;

  /** Ordered; first non-null response short-circuits. */
  preHooks?: readonly FindByPkPreHook<TArgs, TCtx, TKey, TResponse>[];

  respond: FindByPkRespond<TArgs, TKey, TResponse>;
}

/**
 * Build the `find_by_pk` op. `TCtx` must satisfy `FindByPkCtx<TKey>`;
 * the caller binds it to their concrete tool ctx (e.g.
 * `DatabaseOperationContext`).
 */
export function createFindByPkOp<
  TArgs,
  TCtx extends FindByPkCtx<TKey>,
  TResponse,
  TKey = string | number,
>(config: CreateFindByPkOpConfig<TArgs, TCtx, TKey, TResponse>): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "get_by_pk",
    summary: config.summary ?? "Fetch a single row by primary key",
    detail:
      config.detail ??
      "Fetch at most one row by the container's primary key. Whitelist-guarded; PII fields are redacted per the container's field policy.",
    category: config.category ?? "Read",
    argsSchema: config.argsSchema,
    requires: {
      reader: ["PointReader"],
      extras: ["redactor"],
    },
    execute: async ({ args, ctx }) => {
      const container = config.extractContainer(args);
      const key = config.extractKey(args);

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
        const err = await hook({ args, ctx, container, key });
        if (err !== null) return err;
      }

      const fields = ctx.whitelist.getSelectableFields(container);
      const raw = await ctx.reader.readOne({ container, key, fields });
      if (raw === null) return config.respond.notFound({ args, container, key });

      const row = ctx.trait("redactor").redactOne({ container, record: raw });
      return config.respond.ok({ args, container, key, row });
    },
  };
}
