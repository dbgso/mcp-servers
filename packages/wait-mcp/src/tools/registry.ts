import { createDescribeExecuteHandlers, ToolRegistry } from "mcp-shared";
import { loadServerConfig } from "../config.js";
import { createWaitOperationRegistry } from "../operations/registry.js";
import type { WaitContext } from "../operations/types.js";
import { WatchManager } from "../watch/manager.js";

export { ToolRegistry };

const PREAMBLE = `Waiting happens inside this server: it polls in the background and answers once.
Blocking on \`until\`/\`join\` costs no context, so never poll from the agent side in a loop.`;

export function createToolRegistry(manager?: WatchManager): ToolRegistry {
  const config = loadServerConfig((name) => process.env[name]);
  const watchManager =
    manager ??
    new WatchManager({ maxBlockMs: config.maxBlockMs, maxWatches: config.maxWatches });

  const [describe, execute] = createDescribeExecuteHandlers<WaitContext>({
    prefix: "",
    registry: createWaitOperationRegistry(),
    buildContext: () => ({ manager: watchManager }),
    describeDescription:
      "List/inspect wait operations. Call without args for the full listing, or pass operation=<id> for one op's schema.",
    executeDescription:
      "Wait for CI, Slack replies, GitHub issue updates and other external events. Polling runs inside the server, so waiting consumes no context. Use describe to discover operations.",
    listTitle: "Wait Operations",
    preamble: PREAMBLE,
  });

  const registry = new ToolRegistry();
  registry.register(describe);
  registry.register(execute);
  return registry;
}

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = createToolRegistry();
  }
  return registryInstance;
}
