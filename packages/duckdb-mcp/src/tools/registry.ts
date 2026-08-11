import { ToolRegistry } from "mcp-shared";
import { DuckdbDescribeHandler } from "./handlers/describe.js";
import { DuckdbQueryHandler } from "./handlers/query.js";
import { DuckdbCountHandler } from "./handlers/count.js";

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new DuckdbDescribeHandler());
  registry.register(new DuckdbQueryHandler());
  registry.register(new DuckdbCountHandler());
  return registry;
}

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = createToolRegistry();
  }
  return registryInstance;
}
