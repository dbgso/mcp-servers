/**
 * `inspect` op factory — engine-state read via an Inspector method.
 * Currently DB-only (`table_stats` / `show_processlist` etc), but
 * shape generalizes to any future adapter that ships engine
 * introspection (Redis INFO, DDB describeContinuousBackups, ...).
 *
 * Flow: capability check (inspector method present?) → optional
 *       container-gate (some ops target a specific container that
 *       must be whitelisted) → invoke inspector method → optional
 *       post-process (row cap + literal masking) → respond.ok. Any
 *       exception from the inspector is caught and returned via
 *       respond.error.
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { z } from "zod";
import type { Inspector, Operation, ToolContext, Whitelist } from "../interfaces/index.js";

/**
 * Ctx shape: `whitelist` for the optional container-gate,
 * `inspector` for the capability check + method dispatch.
 */
export type InspectCtx = ToolContext<Whitelist<string>, unknown, { inspector: Inspector }>;

export interface InspectRespond<TArgs, TResult, TResponse> {
  ok(input: { args: TArgs; result: TResult }): TResponse;
  notSupported(input: { args: TArgs; opId: string }): TResponse;
  /** Called when args target a container that isn't whitelisted. */
  containerNotWhitelisted?(input: {
    args: TArgs;
    container: string;
    available: readonly string[];
  }): TResponse;
  /** Called on any exception from the inspector method. */
  error(input: { args: TArgs; message: string }): TResponse;
}

export interface CreateInspectionOpConfig<TArgs, TCtx, TResult, TResponse> {
  id: string;
  summary: string;
  detail: string;
  category?: string;

  argsSchema: z.ZodType<TArgs>;

  /**
   * The Inspector method to invoke, e.g.
   *   invoke: ({ctx, args}) => ctx.trait("inspector").getTableStats?.({table: args.table})
   *
   * Return `undefined` when the underlying method isn't implemented
   * (the framework will call respond.notSupported).
   */
  invoke: (input: {
    args: TArgs;
    ctx: TCtx;
  }) => Promise<TResult | undefined> | (TResult | undefined);

  /**
   * Optional: extract the container name the op targets. When set AND
   * the container isn't in the whitelist, respond.containerNotWhitelisted
   * is called and the inspector is never invoked.
   */
  extractContainer?: (args: TArgs) => string | undefined;

  respond: InspectRespond<TArgs, TResult, TResponse>;
}

export function createInspectionOp<TArgs, TCtx extends InspectCtx, TResult, TResponse>(
  config: CreateInspectionOpConfig<TArgs, TCtx, TResult, TResponse>,
): Operation<TArgs, TCtx, TResponse> {
  return {
    id: config.id,
    summary: config.summary,
    detail: config.detail,
    category: config.category ?? "Inspection",
    argsSchema: config.argsSchema,
    requires: {
      extras: ["inspector"],
    },
    execute: async ({ args, ctx }) => {
      // Optional container gate.
      const container = config.extractContainer?.(args);
      if (container !== undefined) {
        if (!ctx.whitelist.hasContainer(container)) {
          if (!config.respond.containerNotWhitelisted) {
            throw new Error(
              `createInspectionOp(${config.id}): extractContainer set but respond.containerNotWhitelisted is not defined.`,
            );
          }
          return config.respond.containerNotWhitelisted({
            args,
            container,
            available: ctx.whitelist.listContainers(),
          });
        }
      }

      try {
        const result = await config.invoke({ args, ctx });
        // undefined = the underlying Inspector method isn't
        // implemented on this adapter (e.g. `getProcessList` missing).
        if (result === undefined) {
          return config.respond.notSupported({ args, opId: config.id });
        }
        return config.respond.ok({ args, result });
      } catch (e) {
        return config.respond.error({ args, message: (e as Error).message });
      }
    },
  };
}
