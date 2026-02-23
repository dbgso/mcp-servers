import { ToolRegistry } from "mcp-shared";
import {
  AstReadHandler,
  AstWriteHandler,
  GoToDefinitionHandler,
  CrawlHandler,
  ReadDirectoryHandler,
  TocGenerateHandler,
  LinkCheckHandler,
  DiffStructureHandler,
  StructuredWriteHandler,
  TopicIndexHandler,
} from "./handlers/index.js";

export { ToolRegistry };

/**
 * Create and initialize the tool registry with all handlers.
 */
function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(new AstReadHandler());
  registry.register(new AstWriteHandler());
  registry.register(new GoToDefinitionHandler());
  registry.register(new CrawlHandler());
  registry.register(new ReadDirectoryHandler());
  registry.register(new TocGenerateHandler());
  registry.register(new LinkCheckHandler());
  registry.register(new DiffStructureHandler());
  registry.register(new StructuredWriteHandler());
  registry.register(new TopicIndexHandler());

  return registry;
}

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
