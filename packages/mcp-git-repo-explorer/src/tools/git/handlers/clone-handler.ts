import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class CloneHandler implements GitActionHandler {
  async execute(params: {
    actionParams: GitActionParams;
    context: GitContext;
  }): Promise<ToolResult> {
    const { actionParams, context } = params;
    const { repoManager } = context;

    const url = actionParams.repository;
    if (!url) {
      return {
        content: [{ type: "text", text: "Error: repository URL is required for clone" }],
        isError: true,
      };
    }

    const result = await repoManager.clone({ url, name: actionParams.path });

    if (!result.success) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Repository cloned successfully to: ${result.path}` }],
    };
  }
}
