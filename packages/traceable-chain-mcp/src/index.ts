#!/usr/bin/env node
import { startServer } from "./server.js";
import { loadConfig } from "./config.js";

// First positional argument is basePath
function parseArgs(): { basePath?: string } {
  const args = process.argv.slice(2);
  if (args.length > 0 && !args[0].startsWith("-")) {
    return { basePath: args[0] };
  }
  return {};
}

const config = loadConfig({ ...parseArgs(), log: msg => console.error(msg) });

startServer(config).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// Export for programmatic use
export { createServer, startServer } from "./server.js";
export { ChainManager } from "./chain-manager.js";
export { loadConfig, getDefaultConfig } from "./config.js";
export * from "./types.js";
