#!/usr/bin/env node
import { startServer } from "./server.js";
import { setBaseDir, getBaseDir } from "./git-repo-manager.js";

// Parse CLI arguments
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith("-")) {
  setBaseDir(args[0]);
}

console.error(`git-repo-explorer-mcp: using base directory: ${getBaseDir()}`);

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
