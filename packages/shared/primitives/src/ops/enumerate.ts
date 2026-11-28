/**
 * `enumerate` op factory — the shared flow behind every tool's "list
 * item identifiers within a container" op. Covers S3 `list_objects`
 * (bucket + prefix → key list + isTruncated + object metadata), Redis
 * `SCAN` (pattern → key list + cursor), and any future tool where
 * containers hold unbounded item sets.
 *
 * # Contract
 *
 * The factory delegates cursor / prefix / limit semantics to the
 * adapter's `Enumerator.enumerate` — this op only enforces:
 *
 *   - container is in the tool's `ContainerAccess` whitelist
 *   - tool-specific pre-hooks (prefix overlap check, pattern validation
 *     etc) get to short-circuit before hitting the backend
 *   - limit is clamped via `LimitPolicy` before reaching the reader
 *   - `meta` from the enumerator response is threaded verbatim to the
 *     op's respond mapper (S3 `isTruncated` + `objects` metadata,
 *     Redis `cursor`)
 *
 * Note: unlike `createContainerReadOp` there is no per-item
 * `isItemAllowed` check inside the factory — the enumerator returns
 * a bulk page and per-item filtering is a tool-local concern (S3's
 * list-objects op filters returned keys post-hoc; Redis's SCAN op
 * uses the pattern itself as the filter). If a tool needs post-hoc
 * item filtering, it wraps the returned respond mapper or the
 * enumerator adapter — the factory stays generic.
 *
 * Flow: container gate → pre-hooks (prefix overlap validation etc) →
 *       limit clamp → `enumerator.enumerate` → respond.ok (with meta).
 *
 * `TIdentifier` is generic: S3 = `string` (object key), Redis =
 * `string` (Redis key), a hypothetical DDB list-tables tool =
 * `{name, arn}`. Default is `string`.
 *
 * See docs/specs/whitelist-abstraction.md §6
 * addendum (Phase B1) and §8.6.
 */

import type { z } from "zod";
import type { ContainerAccess, Enumerator, Operation, ToolContext } from "../interfaces/index.js";

/**
 * Ctx shape the factory expects. Enumerator is on the `extras`
 * bag so tools that don't ship enumeration (RDB / DDB today) can omit
 * it without leaking `undefined` through the reader slot.
 */
export type EnumerateCtx<TIdentifier = string> = ToolContext<
  ContainerAccess<string>,
  unknown,
  {
    enumerator: Enumerator<string, TIdentifier>;
  }
>;

export interface EnumeratePreHookInput<TArgs, TCtx> {
  args: TArgs;
  ctx: TCtx;
  container: string;
  filter: { prefix?: string; match?: string };
  cursor?: string;
  limit: number;
}

/** Return a response to short-circuit; return `null` to continue. */
export type EnumeratePreHook<TArgs, TCtx, TResponse> = (
  input: EnumeratePreHookInput<TArgs, TCtx>,
) => TResponse | null | Promise<TResponse | null>;

export interface EnumerateRespond<TArgs, TIdentifier, TResponse> {
  ok(input: {
    args: TArgs;
    container: string;
    filter: { prefix?: string; match?: string };
    cursor?: string;
    limit: number;
    items: readonly TIdentifier[];
    itemCount: number;
    nextCursor?: string;
    /** Tool-specific paging / diagnostic metadata from the enumerator. */
    meta?: unknown;
  }): TResponse;
  notWhitelisted(input: {
    args: TArgs;
    container: string;
    available: readonly string[];
  }): TResponse;
}

/** Return a response to short-circuit; return `null` to continue. */
export type EnumeratePreContainerGate<TArgs, TCtx, TResponse> = (input: {
  args: TArgs;
  ctx: TCtx;
}) => TResponse | null | Promise<TResponse | null>;

export interface CreateEnumerateOpConfig<TArgs, TCtx, TIdentifier, TResponse> {
  /** Defaults to `"enumerate"`. */
  id?: string;
  /** Defaults to `"List item identifiers within a container"`. */
  summary?: string;
  detail?: string;
  /** Defaults to `"Read"`. */
  category?: string;

  mutates?: boolean;
  requiresAuth?: boolean;
  requiresApproval?: boolean | ((args: unknown) => boolean);
  approvalReason?: string;

  argsSchema: z.ZodType<TArgs>;

  /**
   * Optional hook that runs BEFORE `extractContainer` + container
   * gate. Return a `TResponse` to short-circuit (e.g. tools that
   * derive `container` from `args` and want a specific error when
   * derivation fails); return `null` to continue.
   *
   * Intended for container-derivation-heavy tools (Redis
   * SCAN MATCH → pattern overlap) where the gate error needs richer
   * context than `respond.notWhitelisted({args, container, available})`
   * can carry on its own. Runs unconditionally on every call.
   */
  preContainerGate?: EnumeratePreContainerGate<TArgs, TCtx, TResponse>;

  extractContainer: (args: TArgs) => string;
  /** Defaults to `{}` (no prefix / match filter). */
  extractFilter?: (args: TArgs) => { prefix?: string; match?: string };
  extractCursor?: (args: TArgs) => string | undefined;
  extractLimit?: (args: TArgs) => number | undefined;

  preHooks?: readonly EnumeratePreHook<TArgs, TCtx, TResponse>[];

  respond: EnumerateRespond<TArgs, TIdentifier, TResponse>;
}

/**
 * Build the `enumerate` op. `TCtx` must satisfy
 * `EnumerateCtx<TIdentifier>`; the caller binds it to their concrete
 * tool ctx (e.g. `S3OperationContext`, `RedisOperationContext`).
 */
export function createEnumerateOp<
  TArgs,
  TCtx extends EnumerateCtx<TIdentifier>,
  TResponse,
  TIdentifier = string,
>(
  config: CreateEnumerateOpConfig<TArgs, TCtx, TIdentifier, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id ?? "enumerate",
    summary: config.summary ?? "List item identifiers within a container",
    detail:
      config.detail ??
      "Enumerate identifiers (S3 object keys / Redis keys / ...) inside a whitelisted " +
        "container. Optional prefix / match filter; opaque paging cursor for continuation.",
    category: config.category ?? "Read",
    mutates: config.mutates,
    requiresAuth: config.requiresAuth,
    requiresApproval: config.requiresApproval,
    approvalReason: config.approvalReason,
    argsSchema: config.argsSchema,
    requires: {
      extras: ["enumerator"],
    },
    execute: async ({ args, ctx }) => {
      if (config.preContainerGate) {
        const early = await config.preContainerGate({ args, ctx });
        if (early !== null) return early;
      }

      const container = config.extractContainer(args);

      if (!ctx.whitelist.hasContainer(container)) {
        return config.respond.notWhitelisted({
          args,
          container,
          available: ctx.whitelist.listContainers(),
        });
      }

      const filter = config.extractFilter?.(args) ?? {};
      const cursor = config.extractCursor?.(args);
      const limit = ctx.limit.clamp(config.extractLimit?.(args));

      for (const hook of config.preHooks ?? []) {
        const err = await hook({ args, ctx, container, filter, cursor, limit });
        if (err !== null) return err;
      }

      const page = await ctx.trait("enumerator").enumerate({
        container,
        filter,
        cursor,
        limit,
      });

      return config.respond.ok({
        args,
        container,
        filter,
        cursor,
        limit,
        items: page.items,
        itemCount: page.items.length,
        nextCursor: page.nextCursor,
        meta: page.meta,
      });
    },
  };
}
