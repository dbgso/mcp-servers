import { ToolRegistry } from "mcp-shared";
import type { ChainManager } from "../chain-manager.js";
import { ChainDescribeHandler } from "./handlers/describe.js";
import { ChainQueryHandler } from "./handlers/query.js";
import { ChainMutateHandler } from "./handlers/mutate.js";

export { ToolRegistry };

export function createToolRegistry(manager: ChainManager): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ChainDescribeHandler(manager));
  registry.register(new ChainQueryHandler(manager));
  registry.register(new ChainMutateHandler(manager));
  return registry;
}
