import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { glob } from "glob";
import { parse as parseYaml } from "yaml";

export type WorkspaceType = "pnpm" | "npm" | "yarn" | "unknown";

export interface WorkspaceInfo {
  /** Workspace type */
  type: WorkspaceType;
  /** Monorepo root directory */
  rootDir: string;
  /** Package directories (absolute paths) */
  packageDirs: string[];
}

/**
 * Detect workspace configuration starting from a directory.
 * Walks up the directory tree to find workspace root.
 */
export async function detectWorkspace(startDir: string): Promise<WorkspaceInfo | null> {
  let currentDir = startDir;

  while (currentDir !== dirname(currentDir)) {
    // Check for pnpm workspace
    const pnpmWorkspacePath = join(currentDir, "pnpm-workspace.yaml");
    if (existsSync(pnpmWorkspacePath)) {
      const patterns = parsePnpmWorkspace(pnpmWorkspacePath);
      const packageDirs = await resolvePackageDirs(currentDir, patterns);
      return {
        type: "pnpm",
        rootDir: currentDir,
        packageDirs,
      };
    }

    // Check for npm/yarn workspace in package.json
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const patterns = parseNpmWorkspace(packageJsonPath);
      if (patterns.length > 0) {
        const packageDirs = await resolvePackageDirs(currentDir, patterns);
        // Determine if yarn or npm based on lock file
        const type: WorkspaceType = existsSync(join(currentDir, "yarn.lock"))
          ? "yarn"
          : "npm";
        return {
          type,
          rootDir: currentDir,
          packageDirs,
        };
      }
    }

    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Parse pnpm-workspace.yaml and return package patterns.
 */
function parsePnpmWorkspace(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(content) as { packages?: string[] };
    return parsed.packages ?? [];
  } catch {
    return [];
  }
}

/**
 * Parse package.json workspaces field.
 * Supports both array format and object format (yarn).
 */
function parseNpmWorkspace(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as {
      workspaces?: string[] | { packages?: string[] };
    };

    if (!parsed.workspaces) return [];

    // Array format: ["packages/*"]
    if (Array.isArray(parsed.workspaces)) {
      return parsed.workspaces;
    }

    // Object format (yarn): { packages: ["packages/*"] }
    if (typeof parsed.workspaces === "object" && parsed.workspaces.packages) {
      return parsed.workspaces.packages;
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Resolve workspace patterns to actual package directories.
 * Only includes directories that contain a package.json.
 */
async function resolvePackageDirs(
  rootDir: string,
  patterns: string[]
): Promise<string[]> {
  const packageDirs: string[] = [];

  for (const pattern of patterns) {
    // Handle negation patterns
    if (pattern.startsWith("!")) continue;

    const matches = await glob(pattern, {
      cwd: rootDir,
      absolute: true,
      nodir: false,
    });

    // Filter to only directories (glob doesn't have onlyDirectories option)

    for (const dir of matches) {
      const packageJsonPath = join(dir, "package.json");
      if (existsSync(packageJsonPath)) {
        packageDirs.push(dir);
      }
    }
  }

  return packageDirs;
}
