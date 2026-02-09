import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitActionHandler, GitContext, ReminderConfig } from "../../types/index.js";
import { wrapResponse } from "../../utils/response-wrapper.js";

import { BlameHandler } from "./handlers/blame-handler.js";
import { BranchesHandler } from "./handlers/branches-handler.js";
import { CatFileHandler } from "./handlers/cat-file-handler.js";
import { CloneHandler } from "./handlers/clone-handler.js";
import { DiffHandler } from "./handlers/diff-handler.js";
import { GrepHandler } from "./handlers/grep-handler.js";
import { LogHandler } from "./handlers/log-handler.js";
import { LsFilesHandler } from "./handlers/ls-files-handler.js";
import { RemoveHandler } from "./handlers/remove-handler.js";
import { ReposHandler } from "./handlers/repos-handler.js";
import { ShowHandler } from "./handlers/show-handler.js";

const GIT_HELP = `
# Git Repository Tool

This tool provides read-only git operations on cloned repositories.

## Actions

### Repository Management
- **clone**: Clone a repository (bare clone with worktree support)
  - repository: Git URL to clone
  - path: Optional custom name for the repository

- **repos**: List all cloned repositories and their worktrees

- **remove**: Remove a repository or worktree
  - repository: Repository name
  - branch: Optional - if provided, removes only the worktree for this branch

### File Operations
- **ls-files**: List tracked files
  - repository: Repository name (required)
  - branch: Branch name (optional, defaults to main/master)
  - pattern: Optional glob pattern to filter files

- **cat-file**: Show file content at a specific revision
  - repository: Repository name (required)
  - file: File path (required)
  - branch: Branch name (optional)
  - ref: Git reference (optional, defaults to HEAD)

### Search
- **grep**: Search for patterns in files
  - repository: Repository name (required)
  - pattern: Search pattern (required)
  - branch: Branch name (optional)
  - path: Optional path to limit search

### History
- **log**: Show commit history
  - repository: Repository name (required)
  - branch: Branch name (optional)
  - file: Optional file path to show history for
  - limit: Number of commits (default: 20)
  - format: Custom format string (optional)

- **blame**: Show line-by-line authorship
  - repository: Repository name (required)
  - file: File path (required)
  - branch: Branch name (optional)
  - line: Optional line number (shows context around this line)

- **show**: Show commit details
  - repository: Repository name (required)
  - ref: Commit reference (optional, defaults to HEAD)
  - branch: Branch name (optional)
  - file: Optional file to show changes for

### Comparison
- **diff**: Show differences
  - repository: Repository name (required)
  - ref: Commit reference or range (optional)
  - branch: Branch name (optional)
  - file: Optional file path

- **branches**: List all branches
  - repository: Repository name (required)

## Examples

\`\`\`
# Clone a repository
action: clone, repository: "https://github.com/user/repo.git"

# List files on a specific branch
action: ls-files, repository: "repo", branch: "develop"

# Search for a pattern
action: grep, repository: "repo", pattern: "TODO", branch: "main"

# Show recent commits
action: log, repository: "repo", limit: 10

# Show blame for a file
action: blame, repository: "repo", file: "src/index.ts"
\`\`\`
`.trim();

const actionHandlers: Record<string, GitActionHandler> = {
  clone: new CloneHandler(),
  repos: new ReposHandler(),
  remove: new RemoveHandler(),
  "ls-files": new LsFilesHandler(),
  "cat-file": new CatFileHandler(),
  grep: new GrepHandler(),
  log: new LogHandler(),
  blame: new BlameHandler(),
  show: new ShowHandler(),
  diff: new DiffHandler(),
  branches: new BranchesHandler(),
};

export function registerGitTool(params: {
  server: McpServer;
  context: GitContext;
  config: ReminderConfig;
}): void {
  const { server, context, config } = params;

  server.registerTool(
    "git",
    {
      description: `Git repository operations tool. Supports: clone, repos, remove, ls-files, cat-file, grep, log, blame, show, diff, branches. Call without action for detailed help.`,
      inputSchema: {
        action: z
          .enum([
            "clone",
            "repos",
            "remove",
            "ls-files",
            "cat-file",
            "grep",
            "log",
            "blame",
            "show",
            "diff",
            "branches",
          ])
          .optional()
          .describe("Action to perform"),
        repository: z.string().optional().describe("Repository name or URL (for clone)"),
        branch: z.string().optional().describe("Branch name"),
        path: z.string().optional().describe("File or directory path"),
        pattern: z.string().optional().describe("Search pattern (for grep) or glob pattern (for ls-files)"),
        ref: z.string().optional().describe("Git reference (commit hash, tag, branch)"),
        file: z.string().optional().describe("File path"),
        line: z.number().optional().describe("Line number (for blame)"),
        limit: z.number().optional().describe("Limit number of results"),
        format: z.string().optional().describe("Custom format string (for log)"),
      },
    },
    async ({ action, repository, branch, path, pattern, ref, file, line, limit, format }) => {
      if (!action) {
        return wrapResponse({
          result: { content: [{ type: "text" as const, text: GIT_HELP }] },
          config,
        });
      }

      const handler = actionHandlers[action];
      if (!handler) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: `Error: Unknown action '${action}'` }],
            isError: true,
          },
          config,
        });
      }

      const result = await handler.execute({
        actionParams: { repository, branch, path, pattern, ref, file, line, limit, format },
        context,
      });

      return wrapResponse({ result, config });
    }
  );
}
