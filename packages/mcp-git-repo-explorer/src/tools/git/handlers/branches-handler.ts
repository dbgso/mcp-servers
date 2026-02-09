import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class BranchesHandler implements GitActionHandler {
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

    const repoPath = repoManager.getBaseDir() + "/" + actionParams.repository;

    const args = ["branch", "-a", "--format=%(refname:short)"];

    const result = await executor.execute({
      cwd: repoPath,
      args,
    });

    if (result.exitCode !== 0) {
      return {
        content: [{ type: "text", text: `Error: ${result.stderr}` }],
        isError: true,
      };
    }

    const output = result.stdout || "(no branches)";
    return {
      content: [{ type: "text", text: output }],
    };
  }
}
