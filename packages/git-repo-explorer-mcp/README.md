# git-repo-explorer-mcp

MCP server for exploring git repositories with worktree support.

## Why

- **Fast search** - `git grep` is significantly faster than traditional `find`/`grep` for code exploration
- **Multi-branch investigation** - Explore multiple branches simultaneously without switching contexts
- **No local clone needed** - AI agents can investigate remote repositories without cluttering the local workspace
- **Lightweight** - Sufficient functionality for quick code investigation and research tasks

## Features

- Clone repositories as bare repos for efficient storage
- Worktree support for working with multiple branches simultaneously
- Read-only operations: ls-files, grep, log, blame, show, diff, branches
- File content access via cat-file

## Installation

```bash
npm install git-repo-explorer-mcp
```

## Usage

### As MCP Server

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "git-repo-explorer-mcp": {
      "command": "npx",
      "args": ["-y", "git-repo-explorer-mcp", "/tmp/git-repos", "--remind-mcp"]
    }
  }
}
```

### CLI Options

- `--base-dir <path>`: Base directory for storing repositories (default: `/tmp/mcp-git-<uuid>`)
- `--remind-mcp`: Add MCP usage reminder to responses
- `--remind-org <text>`: Add organization reminder
- `--remind-task <text>`: Add task reminder

## Actions

### Repository Management

| Action | Description | Parameters |
|--------|-------------|------------|
| `clone` | Clone a repository | `repository` (URL), `path` (optional name) |
| `repos` | List all repositories | - |
| `remove` | Remove repo or worktree | `repository`, `branch` (optional) |

### File Operations

| Action | Description | Parameters |
|--------|-------------|------------|
| `ls-files` | List tracked files | `repository`, `branch`, `pattern` |
| `cat-file` | Show file content | `repository`, `file`, `branch`, `ref` |

### Search

| Action | Description | Parameters |
|--------|-------------|------------|
| `grep` | Search in files | `repository`, `pattern`, `branch`, `path` |

### History

| Action | Description | Parameters |
|--------|-------------|------------|
| `log` | Commit history | `repository`, `branch`, `file`, `limit`, `format` |
| `blame` | Line authorship | `repository`, `file`, `branch`, `line` |
| `show` | Commit details | `repository`, `ref`, `branch`, `file` |

### Comparison

| Action | Description | Parameters |
|--------|-------------|------------|
| `diff` | Show differences | `repository`, `ref`, `branch`, `file` |
| `branches` | List branches | `repository` |

## Examples

```typescript
// Clone a repository
{ action: "clone", repository: "https://github.com/user/repo.git" }

// List files on develop branch
{ action: "ls-files", repository: "repo", branch: "develop" }

// Search for TODO comments
{ action: "grep", repository: "repo", pattern: "TODO", branch: "main" }

// Show recent commits
{ action: "log", repository: "repo", limit: 10 }

// Blame a specific file
{ action: "blame", repository: "repo", file: "src/index.ts", line: 42 }
```

## Architecture

Repositories are stored as bare clones in the base directory. When a branch is
accessed, a worktree is automatically created under `.worktrees/<branch-name>/`.

```
/tmp/git-repos/
├── repo-name/           # Bare repository
│   ├── .worktrees/
│   │   ├── main/        # Worktree for main branch
│   │   └── develop/     # Worktree for develop branch
│   ├── objects/
│   ├── refs/
│   └── ...
```

## License

MIT
