import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import {
  detectWorkspace,
  buildMonorepoGraph,
  getDependentPackages,
} from "../../monorepo/index.js";

const MonorepoGraphSchema = z.object({
  root_dir: z
    .string()
    .describe("Monorepo root directory (or any directory within the monorepo)"),
  include_dev: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include devDependencies edges (default: true)"),
});

type MonorepoGraphArgs = z.infer<typeof MonorepoGraphSchema>;

export class MonorepoGraphHandler extends BaseToolHandler<MonorepoGraphArgs> {
  readonly name = "monorepo_graph";
  readonly description =
    "Analyze monorepo package dependencies. Returns packages, internal dependency edges, and cycles. Supports pnpm, npm, and yarn workspaces.";
  readonly schema = MonorepoGraphSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      root_dir: {
        type: "string",
        description:
          "Monorepo root directory (or any directory within the monorepo)",
      },
      include_dev: {
        type: "boolean",
        description: "Include devDependencies edges (default: true)",
      },
    },
    required: ["root_dir"],
  };

  protected async doExecute(args: MonorepoGraphArgs): Promise<ToolResponse> {
    const { root_dir, include_dev } = args;

    // Detect workspace
    const workspace = await detectWorkspace(root_dir);
    if (!workspace) {
      return errorResponse(
        `No workspace configuration found. Looked for pnpm-workspace.yaml or package.json#workspaces starting from ${root_dir}`
      );
    }

    // Build graph
    const graph = buildMonorepoGraph(workspace);

    // Filter edges if needed
    const filteredEdges = include_dev
      ? graph.edges
      : graph.edges.filter((e) => e.type !== "devDependencies");

    const result = {
      ...graph,
      edges: filteredEdges,
    };

    return jsonResponse(result);
  }
}

const DependentsSchema = z.object({
  root_dir: z
    .string()
    .describe("Monorepo root directory (or any directory within the monorepo)"),
  package_name: z.string().describe("Package name to find dependents for"),
});

type DependentsArgs = z.infer<typeof DependentsSchema>;

export class PackageDependentsHandler extends BaseToolHandler<DependentsArgs> {
  readonly name = "package_dependents";
  readonly description =
    "Find packages that depend on a given package (reverse dependencies). Useful for impact analysis.";
  readonly schema = DependentsSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      root_dir: {
        type: "string",
        description:
          "Monorepo root directory (or any directory within the monorepo)",
      },
      package_name: {
        type: "string",
        description: "Package name to find dependents for",
      },
    },
    required: ["root_dir", "package_name"],
  };

  protected async doExecute(args: DependentsArgs): Promise<ToolResponse> {
    const { root_dir, package_name } = args;

    const workspace = await detectWorkspace(root_dir);
    if (!workspace) {
      return errorResponse(`No workspace configuration found from ${root_dir}`);
    }

    const graph = buildMonorepoGraph(workspace);

    // Check if package exists
    const packageExists = graph.packages.some((p) => p.name === package_name);
    if (!packageExists) {
      return errorResponse(
        `Package "${package_name}" not found in workspace. Available: ${graph.packages.map((p) => p.name).join(", ")}`
      );
    }

    const dependents = getDependentPackages({ packageName: package_name, graph });

    // Get full package info for dependents
    const dependentPackages = graph.packages.filter((p) =>
      dependents.includes(p.name)
    );

    return jsonResponse({
      packageName: package_name,
      dependentCount: dependents.length,
      dependents: dependentPackages,
    });
  }
}
