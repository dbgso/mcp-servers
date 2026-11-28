/**
 * `container_read` op factory — the shared flow behind every tool's
 * "read one opaque item from a `ContainerAccess` container" op.
 * Covers S3 `get_object` (bucket + key → body envelope), Redis scalar
 * `get` (pattern + key → string value), and any future tool where
 * the container has no per-field ACL and the payload is opaque.
 *
 * # Difference vs `createFindByPkOp`
 *
 * `createFindByPkOp` is `FieldWhitelist`-tied — it projects
 * `getSelectableFields(container)` down to the reader. That's
 * meaningless for opaque payloads (S3 objects, Redis scalar values),
 * so this factory:
 *
 *   - takes `ContainerAccess<TContainer>` (not `FieldWhitelist`)
 *   - passes the empty field list to the reader (`fields: []`)
 *   - runs the optional `isItemAllowed` gate on the container+key pair
 *     BEFORE the reader call (path-traversal defence + prefix ACL)
 *   - makes `Redactor` optional — most opaque payloads have no
 *     field-level redaction surface; tools opt in when they do
 *
 * Flow: container gate (`whitelist.hasContainer`) → item gate
 *       (`whitelist.isItemAllowed`) → pre-hooks → `reader.readOne` →
 *       optional `redactor.redactOne` (if declared) → respond.ok.
 *
 * `TKey` is generic (S3 = `string`, Redis = `string`, hypothetical
 * DDB composite = `{pk, sk}`). Defaults to `string` for the common
 * scalar-key case.
 *
 * See docs/specs/whitelist-abstraction.md §6
 * addendum (Phase B1).
 */

import type { z } from "zod";
import type {
  ContainerAccess,
  Operation,
  PointReader,
  Redactor,
  ToolContext,
} from "../interfaces/index.js";

/**
 * Ctx shape the factory expects. `TRecord` is the opaque payload the
 * reader returns (S3 `GetObjectResult`, Redis `{value}` etc). `TKey`
 * is the item identifier (typically `string`).
 *
 * The `redactor` extra is declared optional at the type level to
 * match the "opt in per tool" contract — S3 doesn't have one, Redis
 * scalar might not either. When present, the factory calls it once
 * before responding.
 */
export type ContainerReadCtx<TRecord, TKey = string> = ToolContext<
  ContainerAccess<string>,
  PointReader<string, TKey, TRecord>,
  {
    /**
     * Optional. When declared on the tool ctx, the factory pipes the
     * read record through `redactor.redactOne` before responding.
     */
    redactor?: Redactor<string, TRecord>;
  }
>;

export interface ContainerReadPreHookInput<TArgs, TCtx, TKey> {
  args: TArgs;
  ctx: TCtx;
  container: string;
  key: TKey;
}

/** Return a response to short-circuit; return `null` to continue. */
export type ContainerReadPreHook<TArgs, TCtx, TKey, TResponse> = (
  input: ContainerReadPreHookInput<TArgs, TCtx, TKey>,
) => TResponse | null | Promise<TResponse | null>;

export interface ContainerReadRespond<TArgs, TKey, TRecord, TResponse> {
  ok(input: { args: TArgs; container: string; key: TKey; record: TRecord }): TResponse;
  notFound(input: { args: TArgs; container: string; key: TKey }): TResponse;
  notWhitelisted(input: {
    args: TArgs;
    container: string;
    available: readonly string[];
  }): TResponse;
  /** Called when `isItemAllowed({container, item: key})` returns false. */
  itemNotAllowed(input: { args: TArgs; container: string; key: TKey }): TResponse;
}

/** Return a response to short-circuit; return `null` to continue. */
export type ContainerReadPreContainerGate<TArgs, TCtx, TResponse> = (input: {
  args: TArgs;
  ctx: TCtx;
}) => TResponse | null | Promise<TResponse | null>;

export interface CreateContainerReadOpConfig<TArgs, TCtx, TKey, TRecord, TResponse> {
  /** Defaults to `"container_read"`. */
  id?: string;
  /** Defaults to `"Fetch a single opaque item from a container"`. */
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
   * key→pattern) where the gate error needs richer context than
   * `respond.notWhitelisted({args, container, available})` can carry
   * on its own. Runs unconditionally on every call.
   */
  preContainerGate?: ContainerReadPreContainerGate<TArgs, TCtx, TResponse>;

  extractContainer: (args: TArgs) => string;
  extractKey: (args: TArgs) => TKey;

  /**
   * Convert the typed key to the string form `isItemAllowed` expects
   * (S3 object key, Redis full key). Default: `String(key)`.
   */
  keyToItemString?: (key: TKey) => string;

  /**
   * When true, factory calls `redactor.redactOne` on the read record.
   * Default: `false` (opaque payloads have no field-level redaction).
   */
  applyRedactor?: boolean;

  /** Ordered; first non-null response short-circuits. */
  preHooks?: readonly ContainerReadPreHook<TArgs, TCtx, TKey, TResponse>[];

  respond: ContainerReadRespond<TArgs, TKey, TRecord, TResponse>;
}

/**
 * Build the `container_read` op. `TCtx` must satisfy
 * `ContainerReadCtx<TRecord, TKey>`; the caller binds it to their
 * concrete tool ctx (e.g. `S3OperationContext`).
 */
export function createContainerReadOp<
  TArgs,
  TCtx extends ContainerReadCtx<TRecord, TKey>,
  TResponse,
  TRecord,
  TKey = string,
>(
  config: CreateContainerReadOpConfig<TArgs, TCtx, TKey, TRecord, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  const keyToItem = config.keyToItemString ?? ((k: TKey) => String(k));
  const applyRedactor = config.applyRedactor === true;
  return {
    id: config.id ?? "container_read",
    summary: config.summary ?? "Fetch a single opaque item from a container",
    detail:
      config.detail ??
      "Fetch one opaque item (object body / raw value) from a whitelisted container. " +
        "Container + item-key ACL are applied; payload is not field-projected.",
    category: config.category ?? "Read",
    mutates: config.mutates,
    requiresAuth: config.requiresAuth,
    requiresApproval: config.requiresApproval,
    approvalReason: config.approvalReason,
    argsSchema: config.argsSchema,
    requires: {
      reader: ["PointReader"],
      extras: applyRedactor ? ["redactor"] : [],
    },
    execute: async ({ args, ctx }) => {
      if (config.preContainerGate) {
        const early = await config.preContainerGate({ args, ctx });
        if (early !== null) return early;
      }

      const container = config.extractContainer(args);
      const key = config.extractKey(args);

      if (!ctx.whitelist.hasContainer(container)) {
        return config.respond.notWhitelisted({
          args,
          container,
          available: ctx.whitelist.listContainers(),
        });
      }

      const item = keyToItem(key);
      if (!ctx.whitelist.isItemAllowed({ container, item })) {
        return config.respond.itemNotAllowed({ args, container, key });
      }

      for (const hook of config.preHooks ?? []) {
        const err = await hook({ args, ctx, container, key });
        if (err !== null) return err;
      }

      const raw = await ctx.reader.readOne({ container, key, fields: [] });
      if (raw === null) return config.respond.notFound({ args, container, key });

      const record = applyRedactor
        ? ctx.trait("redactor").redactOne({ container, record: raw })
        : raw;

      return config.respond.ok({ args, container, key, record });
    },
  };
}
