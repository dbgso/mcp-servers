import type { z } from "zod";
import type { ToolResponse } from "./types.js";
import type { ApprovalStrategy } from "../utils/approval/strategy.js";

/**
 * Input handed to an operation's handlers. `preview` and `execute` receive the
 * exact same shape — validated args plus the shared context — so it is named
 * once here; a new field (e.g. an abort signal) is added in a single place and
 * both handlers stay in lockstep.
 */
export interface OperationHandlerInput<TArgs, TCtx> {
  /** Validated operation args (z.infer<typeof argsSchema>). */
  args: TArgs;
  /** Shared runtime context (DB client, AWS client, ...). */
  ctx: TCtx;
}

/**
 * An Operation is a sub-action exposed via a describe/execute MCP tool pair.
 *
 * Multiple operations register against a single OperationRegistry, and the
 * describe/execute factory exposes them all under one MCP tool pair (e.g.
 * `db_describe` / `db_execute`).
 *
 * TArgs is the parsed argument type (z.infer<typeof argsSchema>).
 * TCtx is the runtime context shared across operations (DB client, AWS client, etc.).
 */
export interface Operation<TArgs = unknown, TCtx = unknown> {
  /** Stable identifier (e.g. "list_tables", "get_by_pk"). */
  id: string;
  /** One-line summary shown in operation listings. */
  summary: string;
  /** Long-form description, including examples. Shown when the user inspects this op. */
  detail: string;
  /** Optional category for grouping in describe output (e.g. "Discovery", "Read"). */
  category?: string;
  /** Whether the operation modifies state (default: false). Shown in describe. */
  mutates?: boolean;
  /** Whether the operation requires user approval before executing. */
  requiresApproval?: boolean | ((args: unknown) => boolean);
  /**
   * Approval strategy that gates this op. When set, the execute handler blocks
   * the op behind a content-bound human approval obtained via this strategy
   * (see createDescribeExecuteHandlers). Requires `preview` to be defined.
   *
   * The strategy itself, not a name for one: you cannot gate an op on a
   * strategy you have not imported, so there is no way to ask for one that is
   * unavailable at runtime.
   */
  approval?: ApprovalStrategy;
  /**
   * Computes the tool's ground-truth preview — a real diff / dry-run of exactly
   * what the op will change — used as the `what` the human approves. MUST be
   * side-effect free. Required when `approval` is set.
   */
  preview?: (params: OperationHandlerInput<TArgs, TCtx>) => Promise<string> | string;
  /** Zod schema for the operation's args. */
  argsSchema: z.ZodType<TArgs>;
  /** Operation body. Receives validated args and the shared context. */
  execute: (params: OperationHandlerInput<TArgs, TCtx>) => Promise<ToolResponse>;
}

/**
 * Registry of operations keyed by id. Generic over the shared context type
 * so callers get type-safe access to ctx within their operation bodies.
 */
export class OperationRegistry<TCtx = unknown> {
  private readonly operations = new Map<string, Operation<unknown, TCtx>>();

  register<TArgs>(op: Operation<TArgs, TCtx>): void {
    this.operations.set(op.id, op as Operation<unknown, TCtx>);
  }

  registerAll(ops: Operation<unknown, TCtx>[]): void {
    for (const op of ops) this.register(op);
  }

  get(id: string): Operation<unknown, TCtx> | undefined {
    return this.operations.get(id);
  }

  all(): Operation<unknown, TCtx>[] {
    return [...this.operations.values()];
  }

  byCategory(): Record<string, Operation<unknown, TCtx>[]> {
    const grouped: Record<string, Operation<unknown, TCtx>[]> = {};
    for (const op of this.operations.values()) {
      const cat = op.category ?? "Other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(op);
    }
    return grouped;
  }
}

export function createOperationRegistry<TCtx>(
  ops: Operation<unknown, TCtx>[],
): OperationRegistry<TCtx> {
  const reg = new OperationRegistry<TCtx>();
  reg.registerAll(ops);
  return reg;
}
