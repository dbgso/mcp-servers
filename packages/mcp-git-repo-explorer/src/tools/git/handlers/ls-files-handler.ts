import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class LsFilesHandler implements GitActionHandler {
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

    const args = ["ls-files"];

    if (actionParams.pattern) {
      args.push(actionParams.pattern);
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

    const files = result.stdout || "(no files)";
    return {
      content: [{ type: "text", text: files }],
    };
  }
}
