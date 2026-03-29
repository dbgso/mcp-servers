import { ToolRegistry } from "mcp-shared";
import { KrokiDescribeHandler } from "./handlers/describe.js";
import { KrokiRenderHandler } from "./handlers/render.js";

export { ToolRegistry };

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new KrokiDescribeHandler());
  registry.register(new KrokiRenderHandler());
  return registry;
}

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = createToolRegistry();
  }
  return registryInstance;
}
