import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class BlameHandler implements GitActionHandler {
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

    if (!actionParams.file) {
      return {
        content: [{ type: "text", text: "Error: file is required for blame" }],
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

    const args = ["blame", "--date=short"];

    if (actionParams.line) {
      const lineStart = Math.max(1, actionParams.line - 5);
      const lineEnd = actionParams.line + 5;
      args.push(`-L${lineStart},${lineEnd}`);
    }

    args.push(actionParams.file);

    const result = await executor.execute({
      cwd: repoResult.path,
      args,
    });

    if (result.exitCode !== 0) {
      return {
        content: [{ type: "text", text: `Error: ${result.stderr}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: result.stdout }],
    };
  }
}
