import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectOptions } from "ts-morph";

export interface ExtendedOptions {
  resolveToSource: boolean;
}

export interface Config {
  projectOptions: ProjectOptions;
  extendedOptions: ExtendedOptions;
}

const DEFAULT_PROJECT_OPTIONS: ProjectOptions = {
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: false, // Enable for paths/baseUrl resolution
};

const DEFAULT_EXTENDED_OPTIONS: ExtendedOptions = {
  resolveToSource: true,
};

/**
 * Parse command line arguments into config object.
 *
 * Supported formats:
 * - --key=value           → { key: value }
 * - --key                  → { key: true }
 * - --no-key               → { key: false }
 * - --config=/path/to.json → load JSON file and merge
 *
 * Examples:
 * --tsConfigFilePath=/path/to/tsconfig.json
 * --skipAddingFilesFromTsConfig=true
 * --resolveToSource=false
 * --config=/path/to/ast-ts-config.json
 */
export function parseArgs(args: string[]): Config {
  let projectOptions: ProjectOptions = { ...DEFAULT_PROJECT_OPTIONS };
  let extendedOptions: ExtendedOptions = { ...DEFAULT_EXTENDED_OPTIONS };

  for (const arg of args) {
    if (!arg.startsWith("--")) continue;

    const withoutDashes = arg.slice(2);

    // Handle --config=path.json
    if (withoutDashes.startsWith("config=")) {
      const configPath = withoutDashes.slice(7);
      const fileConfig = loadConfigFile(configPath);
      if (fileConfig) {
        projectOptions = { ...projectOptions, ...fileConfig.projectOptions };
        extendedOptions = { ...extendedOptions, ...fileConfig.extendedOptions };
      }
      continue;
    }

    // Handle --no-key (boolean false)
    if (withoutDashes.startsWith("no-")) {
      const key = toCamelCase(withoutDashes.slice(3));
      setOption(key, false, projectOptions, extendedOptions);
      continue;
    }

    // Handle --key=value or --key
    const eqIndex = withoutDashes.indexOf("=");
    if (eqIndex === -1) {
      // --key (boolean true)
      const key = toCamelCase(withoutDashes);
      setOption(key, true, projectOptions, extendedOptions);
    } else {
      // --key=value
      const key = toCamelCase(withoutDashes.slice(0, eqIndex));
      const rawValue = withoutDashes.slice(eqIndex + 1);
      const value = parseValue(rawValue);
      setOption(key, value, projectOptions, extendedOptions);
    }
  }

  return { projectOptions, extendedOptions };
}

function loadConfigFile(configPath: string): Partial<Config> | null {
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load config file: ${configPath}`, error);
    return null;
  }
}

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^\d+\.\d+$/.test(raw)) return parseFloat(raw);
  // Try JSON parse for objects/arrays
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function setOption(
  key: string,
  value: unknown,
  projectOptions: ProjectOptions,
  extendedOptions: ExtendedOptions
): void {
  // Extended options (our custom options)
  if (key in DEFAULT_EXTENDED_OPTIONS) {
    (extendedOptions as unknown as Record<string, unknown>)[key] = value;
  } else {
    // ts-morph ProjectOptions
    (projectOptions as unknown as Record<string, unknown>)[key] = value;
  }
}

/**
 * Find tsconfig.json by traversing up from the given file path.
 */
export function findTsConfig(filePath: string): string | undefined {
  let dir = dirname(filePath);
  const root = "/";

  while (dir !== root) {
    const tsconfig = join(dir, "tsconfig.json");
    if (existsSync(tsconfig)) {
      return tsconfig;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

/**
 * Resolve .d.ts path to source .ts path if possible.
 */
export function resolveToSourcePath(dtsPath: string): string | null {
  // Common patterns: dist/ → src/, build/ → src/, lib/ → src/
  const patterns = [
    { from: "/dist/", to: "/src/" },
    { from: "/build/", to: "/src/" },
    { from: "/lib/", to: "/src/" },
  ];

  for (const { from, to } of patterns) {
    if (dtsPath.includes(from)) {
      const srcPath = dtsPath.replace(from, to).replace(/\.d\.ts$/, ".ts");
      if (existsSync(srcPath)) {
        return srcPath;
      }
      // Try .tsx
      const tsxPath = srcPath.replace(/\.ts$/, ".tsx");
      if (existsSync(tsxPath)) {
        return tsxPath;
      }
    }
  }

  return null;
}
