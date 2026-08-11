import { z } from "zod";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { getErrorMessage } from "mcp-shared";
import { allOperations, getOperation } from "../../operations/registry.js";
import { resolveRepo } from "../../git-repo-manager.js";

const ExecuteSchema = z.object({
  operation: z.string().describe("Operation ID (use git_describe to see available operations)"),
  params: z.record(z.unknown()).optional().default({}).describe("Operation-specific parameters"),
});

type ExecuteArgs = z.infer<typeof ExecuteSchema>;

export class GitExecuteHandler extends BaseToolHandler<ExecuteArgs> {
  readonly name = "git_execute";
  readonly description = "Execute a git operation (all read-only). Use git_describe to see available operations and parameters. Omit repo_url to use current working directory.";
  readonly schema = ExecuteSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        description: "Operation ID (use git_describe to see available operations)",
      },
      params: {
        type: "object",
        description: "Operation-specific parameters",
      },
    },
    required: ["operation"],
  };

  protected async doExecute(args: ExecuteArgs): Promise<ToolResponse> {
    const { operation, params } = args;

    // 1. Lookup operation
    const op = getOperation(operation);
    if (!op) {
      const available = allOperations.map(o => o.id).join(", ");
      return {
        content: [{ type: "text", text: `Unknown operation: "${operation}"\n\nAvailable operations: ${available}` }],
        isError: true,
      };
    }

    // 2. Validate params with Zod
    const parseResult = op.argsSchema.safeParse(params);
    if (!parseResult.success) {
      const errors = parseResult.error.issues
        .map(i => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Validation error for "${operation}":\n${errors}\n\nUse git_describe({ operation: "${operation}" }) to see the parameter schema.` }],
        isError: true,
      };
    }

    const validatedArgs = parseResult.data as Record<string, unknown>;

    // 3. Resolve repo: remote clone if repo_url specified, local cwd otherwise
    try {
      const { repoPath, repoName } = await resolveRepo(validatedArgs.repo_url as string | undefined);

      // 4. Execute
      const result = await op.execute(validatedArgs, { repoPath, repoName });
      return result as ToolResponse;
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error executing git ${operation}: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  }
}
