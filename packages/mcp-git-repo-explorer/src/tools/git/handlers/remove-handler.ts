import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class RemoveHandler implements GitActionHandler {
  async execute(params: {
    actionParams: GitActionParams;
    context: GitContext;
  }): Promise<ToolResult> {
    const { actionParams, context } = params;
    const { repoManager } = context;

    if (!actionParams.repository) {
      return {
        content: [{ type: "text", text: "Error: repository name is required" }],
        isError: true,
      };
    }

    if (actionParams.branch) {
      const result = await repoManager.removeWorktree({
        repository: actionParams.repository,
        branch: actionParams.branch,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Worktree for branch '${actionParams.branch}' removed successfully.` }],
      };
    }

    const result = await repoManager.removeRepository({
      repository: actionParams.repository,
    });

    if (!result.success) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Repository '${actionParams.repository}' removed successfully.` }],
    };
  }
}
