import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReminderConfig } from "../types/index.js";
import { wrapResponse } from "../utils/response-wrapper.js";

const DESCRIPTION = `
# MCP Git Repo Explorer

A Model Context Protocol server for exploring git repositories with worktree support.

## Features

- **Clone repositories** as bare repos for efficient storage
- **Worktree support** for working with multiple branches simultaneously
- **Read-only operations**: ls-files, grep, log, blame, show, diff, branches
- **File content access** via cat-file

## Usage

All operations are performed through the \`git\` tool with an \`action\` parameter.

### Quick Start

1. Clone a repository:
   \`\`\`
   action: clone
   repository: https://github.com/user/repo.git
   \`\`\`

2. List files:
   \`\`\`
   action: ls-files
   repository: repo
   branch: main
   \`\`\`

3. Search for code:
   \`\`\`
   action: grep
   repository: repo
   pattern: "function"
   branch: main
   \`\`\`

4. View history:
   \`\`\`
   action: log
   repository: repo
   limit: 10
   \`\`\`

## Repository Storage

Repositories are stored in: \`/tmp/<session>/\`

Each repository is cloned as a bare repository, and branches are checked out
as worktrees under \`.worktrees/<branch-name>/\`.

## Available Actions

| Action | Description |
|--------|-------------|
| clone | Clone a new repository |
| repos | List cloned repositories |
| remove | Remove repository or worktree |
| ls-files | List tracked files |
| cat-file | Show file content |
| grep | Search in files |
| log | Show commit history |
| blame | Show line authorship |
| show | Show commit details |
| diff | Show differences |
| branches | List branches |

Call the \`git\` tool without an action to see detailed help for each action.
`.trim();

export function registerDescriptionTool(params: {
  server: McpServer;
  config: ReminderConfig;
}): void {
  const { server, config } = params;

  server.registerTool(
    "git-description",
    {
      description: "Get usage instructions for the git repo explorer MCP tool",
      inputSchema: {},
    },
    async () => {
      return wrapResponse({
        result: { content: [{ type: "text" as const, text: DESCRIPTION }] },
        config,
      });
    }
  );
}
