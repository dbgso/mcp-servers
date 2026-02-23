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
  TypeCheckHandler,
  AutoImportHandler,
  InlineTypeHandler,
  ExtractCommonInterfaceHandler,
  TransformAstHandler,
  TransformSignatureHandler,
  TransformCallSiteHandler,
  MonorepoGraphHandler,
  PackageDependentsHandler,
  BatchExecuteHandler,
  FindBlocksHandler,
  RemoveNodesHandler,
  RemoveUnusedImportsHandler,
  QueryAstHandler,
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
  registry.register(new TypeCheckHandler());
  registry.register(new AutoImportHandler());
  registry.register(new InlineTypeHandler());
  registry.register(new ExtractCommonInterfaceHandler());
  registry.register(new TransformAstHandler());
  registry.register(new TransformSignatureHandler());
  registry.register(new TransformCallSiteHandler());
  registry.register(new MonorepoGraphHandler());
  registry.register(new PackageDependentsHandler());
  registry.register(new BatchExecuteHandler());
  registry.register(new FindBlocksHandler());
  registry.register(new RemoveNodesHandler());
  registry.register(new RemoveUnusedImportsHandler());
  registry.register(new QueryAstHandler());

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
