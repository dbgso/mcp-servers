import { errorResponse } from "../utils/mcp-response.js";
import type { ToolHandler, ToolResponse, ZodLikeSchema } from "./types.js";
import { getErrorMessage } from "../utils/error.js";

/**
 * Base class for tool handlers.
 * Provides common functionality for argument parsing and error handling.
 *
 * TArgs is the parsed argument type. At the app level, use:
 *   type MyArgs = z.infer<typeof MySchema>;
 *   class MyHandler extends BaseToolHandler<MyArgs> { ... }
 */
export abstract class BaseToolHandler<TArgs = unknown> implements ToolHandler<TArgs> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: ZodLikeSchema<TArgs>;
  abstract readonly inputSchema: object;

  /**
   * Execute the tool with raw arguments.
   * Parses arguments using the schema and delegates to doExecute.
   */
  async execute(args: unknown): Promise<ToolResponse> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    try {
      return await this.doExecute(parsed.data);
    } catch (error) {
      return errorResponse(
        `Failed to execute ${this.name}: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Implement the actual tool logic with validated arguments.
   */
  protected abstract doExecute(args: TArgs): Promise<ToolResponse>;
}
