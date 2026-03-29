import type { ToolHandler, ToolDefinition } from "./types.js";

/**
 * Registry for MCP tool handlers.
 * Manages tool registration and lookup.
 */
export class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  /**
   * Register a tool handler.
   */
  register(handler: ToolHandler): this {
    this.handlers.set(handler.name, handler);
    return this;
  }

  /**
   * Register multiple tool handlers.
   */
  registerAll(handlers: ToolHandler[]): this {
    for (const handler of handlers) {
      this.register(handler);
    }
    return this;
  }

  /**
   * Get a handler by tool name.
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Get all registered tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get all tool definitions for MCP listing.
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.handlers.values()).map((handler) => ({
      name: handler.name,
      description: handler.description,
      inputSchema: handler.inputSchema as ToolDefinition["inputSchema"],
    }));
  }
}
