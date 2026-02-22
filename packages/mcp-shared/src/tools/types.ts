/**
 * MCP tool response format.
 * Uses index signature to satisfy MCP SDK requirements.
 */
export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Tool definition for MCP listing.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Minimal interface for zod-like schema (avoids importing zod types).
 * Only requires safeParse for runtime validation.
 */
export interface ZodLikeSchema<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

/**
 * Interface for tool handlers.
 * TArgs is the parsed argument type (use z.infer<typeof schema> at app level).
 */
export interface ToolHandler<TArgs = unknown> {
  /** Tool name */
  readonly name: string;

  /** Tool description for MCP */
  readonly description: string;

  /** Zod schema for argument validation (type-erased to avoid slow compilation) */
  readonly schema: ZodLikeSchema<TArgs>;

  /** JSON Schema for MCP tool listing */
  readonly inputSchema: object;

  /** Execute the tool with raw arguments (validation is done internally) */
  execute(args: unknown): Promise<ToolResponse>;
}
