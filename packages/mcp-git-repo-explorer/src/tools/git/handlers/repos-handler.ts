import type { GitActionHandler, GitActionParams, GitContext, ToolResult } from "../../../types/index.js";

export class ReposHandler implements GitActionHandler {
  async execute(params: {
    actionParams: GitActionParams;
    context: GitContext;
  }): Promise<ToolResult> {
    const { context } = params;
    const { repoManager } = context;

    const repos = await repoManager.listRepositories();

    if (repos.length === 0) {
      return {
        content: [{ type: "text", text: "No repositories found. Use 'clone' action to add a repository." }],
      };
    }

    const lines: string[] = [];

    for (const repo of repos) {
      lines.push(`## ${repo.name}`);
      lines.push(`URL: ${repo.url}`);
      lines.push(`Path: ${repo.localPath}`);

      if (repo.worktrees.length > 0) {
        lines.push("Worktrees:");
        for (const wt of repo.worktrees) {
          lines.push(`  - ${wt.branch}: ${wt.path}`);
        }
      }

      lines.push("");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
}
