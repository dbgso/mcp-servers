import { errorResponse } from "../utils/mcp-response.js";
import type { ToolResponse, ZodLikeSchema } from "./types.js";
import { getErrorMessage } from "../utils/error.js";

/**
 * Base class for action handlers within a single MCP tool.
 *
 * Use this for tools with an "action" parameter that dispatches to different handlers.
 * Example: plan(action: "add", ...), plan(action: "list", ...)
 *
 * TArgs is the parsed argument type (use z.infer<typeof schema>)
 * TContext is the context type passed to all handlers
 *
 * @example
 * ```typescript
 * const addSchema = z.object({ id: z.string(), title: z.string() });
 * type AddArgs = z.infer<typeof addSchema>;
 *
 * class AddHandler extends BaseActionHandler<AddArgs, PlanContext> {
 *   readonly action = "add";
 *   readonly help = "Add a new task";
 *   readonly schema = addSchema;
 *
 *   protected async doExecute(args: AddArgs, context: PlanContext): Promise<ToolResponse> {
 *     // Implementation
 *   }
 * }
 * ```
 */
export abstract class BaseActionHandler<TArgs = unknown, TContext = unknown> {
  /** Action name (e.g., "add", "list", "delete") */
  abstract readonly action: string;

  /** Help text shown when user requests help for this action */
  abstract readonly help: string;

  /** Zod schema for argument validation */
  abstract readonly schema: ZodLikeSchema<TArgs>;

  /**
   * Execute the action with raw parameters.
   * Parses arguments using the schema and delegates to doExecute.
   */
  async execute(rawParams: unknown, context: TContext): Promise<ToolResponse> {
    const parsed = this.schema.safeParse(rawParams);
    if (!parsed.success) {
      return errorResponse(
        `Error: [${this.action}] ${parsed.error.message}\n\n${this.help}`
      );
    }

    try {
      return await this.doExecute(parsed.data, context);
    } catch (error) {
      return errorResponse(
        `Failed to execute ${this.action}: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Implement the actual action logic with validated arguments.
   */
  protected abstract doExecute(args: TArgs, context: TContext): Promise<ToolResponse>;
}
