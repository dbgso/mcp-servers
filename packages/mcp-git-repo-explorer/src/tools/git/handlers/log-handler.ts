import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class LogHandler implements GitActionHandler {
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

    const limit = actionParams.limit ?? 20;
    const format = actionParams.format ?? "%h %ad %an: %s";

    const args = ["log", `--format=${format}`, "--date=short", `-n`, String(limit)];

    if (actionParams.file) {
      args.push("--", actionParams.file);
    }

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

    const output = result.stdout || "(no commits)";
    return {
      content: [{ type: "text", text: output }],
    };
  }
}
