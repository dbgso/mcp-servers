import { ToolRegistry } from "mcp-shared";
import { TsAstHandler } from "./ts_ast/index.js";

// Re-export ToolRegistry from mcp-shared
export { ToolRegistry };

/**
 * Create and initialize the tool registry with ts_ast handler.
 */
function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new TsAstHandler());
  return registry;
}

// Singleton instance
let registryInstance: ToolRegistry | null = null;

/**
 * Get the singleton tool registry instance.
 */
export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = createToolRegistry();
  }
  return registryInstance;
}
