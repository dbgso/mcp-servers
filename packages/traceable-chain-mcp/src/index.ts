#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { startServer } from "./server.js";
import { ChainConfigSchema } from "./types.js";

// Parse command line arguments
function parseArgs(): { basePath?: string } {
  const args = process.argv.slice(2);
  const result: { basePath?: string } = {};

  // First positional argument is basePath
  if (args.length > 0 && !args[0].startsWith("-")) {
    result.basePath = args[0];
  }

  return result;
}

// Default config for document workflow
function getDefaultConfig(basePath: string) {
  return {
    types: {
      requirement: {
        requires: null,
        description: "Business requirement",
      },
      spec: {
        requires: "requirement",
        description: "Technical specification",
      },
      design: {
        requires: "spec",
        description: "Implementation design",
      },
      implementation: {
        requires: "design",
        description: "Implementation notes",
      },
      test: {
        requires: ["spec", "design"],
        description: "Test plan or results",
      },
      proposal: {
        requires: ["requirement", "spec", "design", "implementation"],
        description: "Decision proposal/option",
      },
      adr: {
        requires: "proposal",
        description: "Architecture Decision Record",
      },
    },
    storage: {
      basePath,
      extension: ".md",
    },
  };
}

// Try to load config from file
function loadConfig(cliBasePath?: string) {
  const configPaths = [
    "chain.config.yaml",
    "chain.config.yml",
    "chain.config.json",
    ".chain.yaml",
    ".chain.yml",
    ".chain.json",
  ];

  for (const configPath of configPaths) {
    const fullPath = path.resolve(process.cwd(), configPath);
    if (existsSync(fullPath)) {
      console.error(`Loading config from ${configPath}`);
      const content = readFileSync(fullPath, "utf-8");
      const parsed = configPath.endsWith(".json")
        ? JSON.parse(content)
        : parseYaml(content);
      const config = ChainConfigSchema.parse(parsed);

      // CLI basePath overrides config file
      if (cliBasePath) {
        config.storage = { ...config.storage, basePath: cliBasePath };
        console.error(`Using CLI basePath: ${cliBasePath}`);
      }

      return config;
    }
  }

  const basePath = cliBasePath ?? "./docs/chain";
  console.error(`Using basePath: ${basePath}`);
  return ChainConfigSchema.parse(getDefaultConfig(basePath));
}

const cliArgs = parseArgs();
const config = loadConfig(cliArgs.basePath);

startServer(config).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// Export for programmatic use
export { createServer, startServer } from "./server.js";
export { ChainManager } from "./chain-manager.js";
export * from "./types.js";
