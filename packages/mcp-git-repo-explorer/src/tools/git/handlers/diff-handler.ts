import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class DiffHandler implements GitActionHandler {
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

    const args = ["diff"];

    if (actionParams.ref) {
      args.push(actionParams.ref);
    }

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

    const output = result.stdout || "(no differences)";
    return {
      content: [{ type: "text", text: output }],
    };
  }
}
