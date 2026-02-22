import { ToolRegistry } from "mcp-shared";
import {
  TsStructureReadHandler,
  TsStructureWriteHandler,
  GoToDefinitionHandler,
  FindReferencesHandler,
  CallGraphHandler,
  TypeHierarchyHandler,
  ExtractInterfaceHandler,
  DiffStructureHandler,
  DependencyGraphHandler,
  RenameSymbolHandler,
  DeadCodeHandler,
  QueryGraphHandler,
} from "./handlers/index.js";

// Re-export ToolRegistry from mcp-shared
export { ToolRegistry };

/**
 * Create and initialize the tool registry with all handlers.
 */
function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(new TsStructureReadHandler());
  registry.register(new TsStructureWriteHandler());
  registry.register(new GoToDefinitionHandler());
  registry.register(new FindReferencesHandler());
  registry.register(new CallGraphHandler());
  registry.register(new TypeHierarchyHandler());
  registry.register(new ExtractInterfaceHandler());
  registry.register(new DiffStructureHandler());
  registry.register(new DependencyGraphHandler());
  registry.register(new RenameSymbolHandler());
  registry.register(new DeadCodeHandler());
  registry.register(new QueryGraphHandler());

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
