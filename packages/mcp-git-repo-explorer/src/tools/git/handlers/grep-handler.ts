import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class GrepHandler implements GitActionHandler {
  async execute(params: {
    actionParams: GitActionParams;
    context: GitContext;
  }): Promise<ToolResult> {
    const { actionParams, context } = params;
    const { executor, repoManager } = context;

    if (!actionParams.repository) {
      return {
        content: [{ type: "text", text: "Error: repository name is required" }],
        isError: true,
      };
    }

    if (!actionParams.pattern) {
      return {
        content: [{ type: "text", text: "Error: pattern is required for grep" }],
        isError: true,
      };
    }

    const repoResult = await repoManager.getRepoPath({
      repository: actionParams.repository,
      branch: actionParams.branch,
    });

    if (!repoResult.success) {
      return {
        content: [{ type: "text", text: `Error: ${repoResult.error}` }],
        isError: true,
      };
    }

    const args = ["grep", "-n", actionParams.pattern];

    if (actionParams.path) {
      args.push("--", actionParams.path);
    }

    const result = await executor.execute({
      cwd: repoResult.path,
      args,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        content: [{ type: "text", text: `Error: ${result.stderr}` }],
        isError: true,
      };
    }

    const output = result.stdout || "(no matches found)";
    return {
      content: [{ type: "text", text: output }],
    };
  }
}
