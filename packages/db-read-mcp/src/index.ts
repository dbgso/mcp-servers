#!/usr/bin/env node
import { parseArgs } from "./cli.js";
import { startServer } from "./server.js";

startServer({ cli: parseArgs(process.argv.slice(2)) }).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
