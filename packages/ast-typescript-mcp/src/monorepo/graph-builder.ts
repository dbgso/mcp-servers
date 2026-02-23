import type { WorkspaceInfo } from "./workspace-detector.js";
import {
  parseAllPackages,
} from "./package-resolver.js";

export interface PackageNode {
  /** Package name */
  name: string;
  /** Absolute path to package directory */
  path: string;
  /** Relative path from monorepo root */
  relativePath: string;
}

export interface PackageEdge {
  /** Dependency source package name */
  from: string;
  /** Dependency target package name */
  to: string;
  /** Dependency type */
  type: "dependencies" | "devDependencies" | "peerDependencies";
  /** Version specifier */
  version: string;
}

export interface MonorepoGraph {
  /** Workspace type */
  workspaceType: "pnpm" | "npm" | "yarn" | "unknown";
  /** Monorepo root directory */
  rootDir: string;
  /** Package nodes */
  packages: PackageNode[];
  /** Dependency edges (internal only) */
  edges: PackageEdge[];
  /** Detected cycles */
  cycles: string[][];
}

/**
 * Build monorepo dependency graph from workspace info.
 */
export function buildMonorepoGraph(workspace: WorkspaceInfo): MonorepoGraph {
  const packages = parseAllPackages({ packageDirs: workspace.packageDirs, rootDir: workspace.rootDir });
  const internalNames = new Set(packages.map((p) => p.name));

  const nodes: PackageNode[] = packages.map((pkg) => ({
    name: pkg.name,
    path: pkg.path,
    relativePath: pkg.relativePath,
  }));

  const edges: PackageEdge[] = [];

  // Build edges for each package
  for (const pkg of packages) {
    // Process each dependency type
    const depTypes = [
      { deps: pkg.dependencies, type: "dependencies" as const },
      { deps: pkg.devDependencies, type: "devDependencies" as const },
      { deps: pkg.peerDependencies, type: "peerDependencies" as const },
    ];

    for (const { deps, type } of depTypes) {
      for (const [depName, version] of Object.entries(deps)) {
        // Only include internal dependencies
        if (internalNames.has(depName)) {
          edges.push({
            from: pkg.name,
            to: depName,
            type,
            version,
          });
        }
      }
    }
  }

  // Detect cycles using Tarjan's algorithm
  const cycles = detectCycles({ nodes: nodes, edges: edges });

  return {
    workspaceType: workspace.type,
    rootDir: workspace.rootDir,
    packages: nodes,
    edges,
    cycles,
  };
}

/**
 * Get packages that depend on a given package (reverse dependencies).
 */
export function getDependentPackages(
  { packageName, graph }: { packageName: string; graph: MonorepoGraph }
): string[] {
  return graph.edges
    .filter((edge) => edge.to === packageName)
    .map((edge) => edge.from);
}

/**
 * Get packages that a given package depends on.
 */
export function getPackageDependencies(
  { packageName, graph }: { packageName: string; graph: MonorepoGraph }
): string[] {
  return graph.edges
    .filter((edge) => edge.from === packageName)
    .map((edge) => edge.to);
}

/**
 * Detect cycles using Tarjan's strongly connected components algorithm.
 */
function detectCycles({ nodes, edges }: { nodes: PackageNode[]; edges: PackageEdge[] }): string[][] {
  const graph = new Map<string, string[]>();

  // Build adjacency list
  for (const node of nodes) {
    graph.set(node.name, []);
  }
  for (const edge of edges) {
    graph.get(edge.from)?.push(edge.to);
  }

  // Tarjan's algorithm
  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongconnect(v: string) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        const vLowlink = lowlinks.get(v) ?? 0;
        const wLowlink = lowlinks.get(w) ?? 0;
        lowlinks.set(v, Math.min(vLowlink, wLowlink));
      } else if (onStack.has(w)) {
        const vLowlink = lowlinks.get(v) ?? 0;
        const wIndex = indices.get(w) ?? 0;
        lowlinks.set(v, Math.min(vLowlink, wIndex));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      // Only include SCCs with more than one node (actual cycles)
      if (scc.length > 1) {
        sccs.push(scc.reverse());
      }
    }
  }

  for (const node of nodes) {
    if (!indices.has(node.name)) {
      strongconnect(node.name);
    }
  }

  return sccs;
}
