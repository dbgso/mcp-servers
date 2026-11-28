import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ChainConfig } from "./types.js";
import { ChainConfigSchema } from "./types.js";

export const CONFIG_FILE_NAMES = [
  "chain.config.yaml",
  "chain.config.yml",
  "chain.config.json",
  ".chain.yaml",
  ".chain.yml",
  ".chain.json",
];

export const DEFAULT_BASE_PATH = "./docs/chain";

/**
 * The default chain: decisions start from a philosophy and are carried down
 * one level at a time until they reach code.
 */
export function getDefaultConfig(basePath: string): ChainConfig {
  return ChainConfigSchema.parse({
    types: {
      philosophy: {
        requires: null,
        description: "Why the product exists and what it values. Every decision traces back to one.",
        realizedBy: "requirement",
      },
      requirement: {
        requires: "philosophy",
        description: "What must be true, derived from a philosophy",
        realizedBy: "spec",
      },
      spec: {
        requires: "requirement",
        description: "Externally observable behaviour that satisfies a requirement",
        realizedBy: "design",
      },
      design: {
        requires: "spec",
        description: "How the spec is built",
        realizedBy: "implementation",
      },
      implementation: {
        requires: "design",
        description: "Implementation notes, bound to the code that realizes the design",
        bindsCode: true,
      },
      test: {
        requires: ["spec", "design"],
        description: "Test plan or results, bound to the test code",
        bindsCode: true,
      },
      proposal: {
        requires: ["philosophy", "requirement", "spec", "design", "implementation"],
        description: "Decision proposal/option",
        realizedBy: "adr",
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
  });
}

function parseConfigFile(fullPath: string): ChainConfig {
  const content = readFileSync(fullPath, "utf-8");
  const parsed: unknown = fullPath.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
  const config = ChainConfigSchema.parse(parsed);
  // Paths in a config file are relative to the file, not to wherever the tool was started
  const dir = path.dirname(fullPath);
  config.storage = { ...config.storage, basePath: path.resolve(dir, config.storage.basePath) };
  config.codeRoot = path.resolve(dir, config.codeRoot ?? ".");
  return config;
}

function findConfigFile(cwd: string): string | undefined {
  return CONFIG_FILE_NAMES.map(name => path.resolve(cwd, name)).find(p => existsSync(p));
}

/**
 * Load the chain config.
 *
 * An explicit config file wins, then a config file in `cwd`, then the
 * default. A base path given on the command line overrides the config's.
 */
export function loadConfig(params: { cwd?: string; basePath?: string; configPath?: string; log?: (msg: string) => void }): ChainConfig {
  const { cwd = process.cwd(), basePath, configPath, log = () => undefined } = params;
  const file = configPath ? path.resolve(cwd, configPath) : findConfigFile(cwd);
  if (configPath && !existsSync(path.resolve(cwd, configPath))) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const config = file ? parseConfigFile(file) : getDefaultConfig(path.resolve(cwd, basePath ?? DEFAULT_BASE_PATH));
  log(file ? `Loading config from ${file}` : "Using default config");
  if (basePath) {
    config.storage = { ...config.storage, basePath: path.resolve(cwd, basePath) };
  }
  config.codeRoot = config.codeRoot ?? cwd;
  log(`Using basePath: ${config.storage.basePath}`);
  return config;
}
