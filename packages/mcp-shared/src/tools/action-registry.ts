import type { ToolResponse } from "./types.js";

/**
 * Interface for action handlers that can be registered with ActionRegistry.
 * BaseActionHandler implements this interface.
 */
export interface RegistrableActionHandler<TContext = unknown> {
  readonly action: string;
  readonly help: string;
  execute(params: { rawParams: unknown; context: TContext }): Promise<ToolResponse>;
}

/**
 * Registry for action handlers within a single MCP tool.
 *
 * Use this to manage multiple action handlers for a tool with "action" dispatch pattern.
 *
 * @example
 * ```typescript
 * const registry = new ActionRegistry<PlanContext>();
 * registry.registerAll([
 *   new AddHandler(),
 *   new ListHandler(),
 *   new DeleteHandler(),
 * ]);
 *
 * // In tool handler
 * const handler = registry.getHandler(action);
 * if (handler) {
 *   return handler.execute(rawParams, context);
 * }
 * ```
 */
export class ActionRegistry<TContext = unknown> {
  private handlers: Map<string, RegistrableActionHandler<TContext>> = new Map();

  /**
   * Register an action handler.
   * @throws Error if handler for this action is already registered
   */
  register(handler: RegistrableActionHandler<TContext>): this {
    if (this.handlers.has(handler.action)) {
      throw new Error(`Handler for action "${handler.action}" is already registered`);
    }
    this.handlers.set(handler.action, handler);
    return this;
  }

  /**
   * Register multiple action handlers.
   */
  registerAll(handlers: RegistrableActionHandler<TContext>[]): this {
    for (const handler of handlers) {
      this.register(handler);
    }
    return this;
  }

  /**
   * Get a handler by action name.
   */
  getHandler(action: string): RegistrableActionHandler<TContext> | undefined {
    return this.handlers.get(action);
  }

  /**
   * Check if an action is registered.
   */
  hasHandler(action: string): boolean {
    return this.handlers.has(action);
  }

  /**
   * Get all registered action names.
   */
  getActions(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get help text for all actions.
   */
  getAllHelp(): string {
    return Array.from(this.handlers.values())
      .map((h) => `## ${h.action}\n\n${h.help}`)
      .join("\n\n---\n\n");
  }

  /**
   * Get help text for a specific action.
   */
  getHelp(action: string): string | undefined {
    return this.handlers.get(action)?.help;
  }
}
