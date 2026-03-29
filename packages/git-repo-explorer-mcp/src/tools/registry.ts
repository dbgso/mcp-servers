import { ToolRegistry } from "mcp-shared";
import { GitDescribeHandler } from "./handlers/describe.js";
import { GitExecuteHandler } from "./handlers/execute.js";

export { ToolRegistry };

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new GitDescribeHandler());
  registry.register(new GitExecuteHandler());
  return registry;
}

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = createToolRegistry();
  }
  return registryInstance;
}
