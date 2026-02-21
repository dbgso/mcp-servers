#!/usr/bin/env node
import { startServer } from "./server.js";
import { parseArgs } from "./config.js";
import { initHandler } from "./handlers/index.js";

// Parse command line arguments into config
const config = parseArgs(process.argv.slice(2));

// Initialize handler with config
initHandler(config);

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
