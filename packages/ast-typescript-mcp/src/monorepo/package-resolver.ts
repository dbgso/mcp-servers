import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface PackageInfo {
  /** Package name from package.json */
  name: string;
  /** Absolute path to package directory */
  path: string;
  /** Relative path from monorepo root */
  relativePath: string;
  /** Main entry point */
  main?: string;
  /** Types entry point */
  types?: string;
  /** Dependencies */
  dependencies: Record<string, string>;
  /** Dev dependencies */
  devDependencies: Record<string, string>;
  /** Peer dependencies */
  peerDependencies: Record<string, string>;
}

export interface PackageJson {
  name?: string;
  main?: string;
  types?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Parse package.json and extract package info.
 */
export function parsePackage(packageDir: string, rootDir: string): PackageInfo | null {
  try {
    const packageJsonPath = join(packageDir, "package.json");
    const content = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(content) as PackageJson;

    if (!parsed.name) return null;

    return {
      name: parsed.name,
      path: packageDir,
      relativePath: relative(rootDir, packageDir),
      main: parsed.main ?? parsed.module,
      types: parsed.types,
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {},
      peerDependencies: parsed.peerDependencies ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Parse all packages in a workspace.
 */
export function parseAllPackages(
  packageDirs: string[],
  rootDir: string
): PackageInfo[] {
  const packages: PackageInfo[] = [];

  for (const dir of packageDirs) {
    const pkg = parsePackage(dir, rootDir);
    if (pkg) {
      packages.push(pkg);
    }
  }

  return packages;
}

/**
 * Build a map from package name to package info.
 */
export function buildPackageMap(packages: PackageInfo[]): Map<string, PackageInfo> {
  const map = new Map<string, PackageInfo>();
  for (const pkg of packages) {
    map.set(pkg.name, pkg);
  }
  return map;
}

/**
 * Find the package that contains a given file path.
 */
export function findPackageForFile(
  filePath: string,
  packages: PackageInfo[]
): PackageInfo | null {
  // Sort by path length descending to find the most specific match
  const sorted = [...packages].sort((a, b) => b.path.length - a.path.length);

  for (const pkg of sorted) {
    if (filePath.startsWith(pkg.path)) {
      return pkg;
    }
  }

  return null;
}
