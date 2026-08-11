# git-repo-explorer-mcp

Read-only MCP server for exploring git repositories (local working dir or remote
clones) plus GitHub metadata via the `gh` CLI.

## Why

- **Fast search** – `git grep` is significantly faster than `find`/`grep` for code exploration
- **Multi-branch investigation** – Inspect any branch by passing `ref` to an operation; no checkout or worktree needed because every command targets the ref directly against the bare repo
- **No local clone needed** – Pass a `repo_url` and the server bare-clones into a cache directory; agents can investigate remote repos without cluttering the workspace
- **GitHub metadata** – List repos, PRs, and PR review comments via the user's authenticated `gh` CLI, with on-disk caching to avoid rate limits

## Installation

```bash
npm install -g git-repo-explorer-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "git-repo-explorer-mcp": {
      "command": "npx",
      "args": ["-y", "git-repo-explorer-mcp", "/tmp/git-repos"]
    }
  }
}
```

### Base directory

Where remote-cloned bare repositories are stored. Resolution order:

1. First positional CLI argument (e.g. `git-repo-explorer-mcp /tmp/git-repos`)
2. `GIT_REPO_EXPLORER_BASE_DIR` environment variable
3. Default: `~/.cache/git-repo-explorer-mcp`

## Tools

The server exposes two MCP tools. All git operations are **read-only**.

### `git_describe`

List available operations or fetch the parameter schema for one.

```ts
// List all operations grouped by category
git_describe()

// Show details + JSON schema for a specific operation
git_describe({ operation: "grep" })
```

### `git_execute`

Run an operation by ID with its parameters.

```ts
git_execute({ operation: "<id>", params: { ... } })
```

If `params.repo_url` is provided the server bare-clones (or fetches) that
repository under the base directory and runs the operation against it. If
omitted, the operation runs against the current working directory's git repo.

## Operations

### Search

| Operation | Summary | Required params | Optional params |
|-----------|---------|-----------------|-----------------|
| `grep` | Search code with `git grep` (regex supported) | `pattern` | `repo_url`, `ref` (default `HEAD`), `path`, `ignore_case`, `max_count` (1–500, default 100) |

### File

| Operation | Summary | Required params | Optional params |
|-----------|---------|-----------------|-----------------|
| `ls_files` | List tracked files | – | `repo_url`, `ref` (default `HEAD`), `path`, `pattern` (glob, e.g. `**/*.ts`) |
| `show` | Show commit details or file content at a ref | `ref` | `repo_url`, `path` (omit to show commit, include for file content) |

### History

| Operation | Summary | Required params | Optional params |
|-----------|---------|-----------------|-----------------|
| `log` | Commit history | – | `repo_url`, `ref` (default `HEAD`), `path`, `max_count` (1–100, default 20), `author`, `since`, `until`, `grep` |
| `blame` | Line-by-line author/commit | `path` | `repo_url`, `ref` (default `HEAD`), `line_start`, `line_end` |
| `diff` | Diff between two refs | `ref_from`, `ref_to` | `repo_url`, `path` |

### Reference

| Operation | Summary | Required params | Optional params |
|-----------|---------|-----------------|-----------------|
| `branch_list` | List branches | – | `repo_url`, `pattern` (e.g. `feature/*`) |
| `tag_list` | List tags (newest first) | – | `repo_url`, `pattern` (e.g. `v2.*`), `max_count` (1–500) |

### GitHub (requires `gh` CLI)

These operations call the GitHub CLI under the hood. They require `gh auth login`
to have been completed in advance; otherwise the operation returns an error
result with the message `gh CLI is not installed or not authenticated. Run \`gh auth login\` first.`

Results are cached as JSON files under `<os.tmpdir()>/git-repo-explorer-gh-cache/`,
keyed by operation + arguments. Within the TTL the call is served from disk and
the response includes `from_cache: true` plus `cache_age_seconds`. Pass
`force_refresh: true` to bypass the cache, or `ttl_minutes` (1–60) to override
the TTL per call.

| Operation | Summary | Required params | Optional params | Default TTL |
|-----------|---------|-----------------|-----------------|-------------|
| `repo_list` | List repositories in a GitHub org/user | `org` | `query` (name substring), `language`, `include_archived` (default `false`), `limit` (1–200, default 50), `force_refresh`, `ttl_minutes` | 5 min |
| `pr_list` | List pull requests in a repo | `repo` (`owner/repo`) | `state` (`open`/`closed`/`merged`/`all`, default `open`), `author`, `base`, `query` (title substring), `label`, `limit` (1–200, default 50), `force_refresh`, `ttl_minutes` | 3 min |
| `pr_comments` | List PR review comments classified as human or bot | `repo` (`owner/repo`), `pr_number` | `filter` (`all`/`human`/`bot`, default `all`), `limit` (1–200, default 50), `force_refresh`, `ttl_minutes` | 3 min |

#### `pr_comments` classification

`pr_comments` merges two GitHub endpoints (`/pulls/:n/reviews` and
`/pulls/:n/comments`), sorts entries ascending by `created_at`, and deduplicates
by `author:path:line:body[0..100]`. Each entry is tagged `is_bot: true` when the
login matches any of:

- `[bot]` suffix
- `github-actions`, `dependabot`, `renovate`, `copilot`
- `coderabbit*`, `codacy*`, `sonarcloud*`, `deepsource*`, `snyk*`, `devin-ai*`, `claude*` (case-insensitive prefix)

The response always reports the unfiltered counts in `summary: { total, human, bot }`,
even when `filter` narrows the returned `comments` array.

## Examples

```ts
// Search the local repo for TODOs on main
git_execute({ operation: "grep", params: { pattern: "TODO", ref: "main" } })

// List TypeScript files in a remote repo's develop branch
git_execute({
  operation: "ls_files",
  params: {
    repo_url: "git@github.com:org/repo.git",
    ref: "develop",
    pattern: "**/*.ts",
  },
})

// Recent commits by an author
git_execute({
  operation: "log",
  params: { author: "alice", since: "2026-01-01", max_count: 10 },
})

// Diff between two refs
git_execute({ operation: "diff", params: { ref_from: "main", ref_to: "feat/x" } })

// List TypeScript repos in an org (skips archived by default)
git_execute({ operation: "repo_list", params: { org: "dbgso", language: "TypeScript" } })

// Open PRs by an author
git_execute({ operation: "pr_list", params: { repo: "dbgso/mcp-servers", author: "alice" } })

// Only human reviewer comments on a PR
git_execute({
  operation: "pr_comments",
  params: { repo: "dbgso/mcp-servers", pr_number: 42, filter: "human" },
})
```

## Architecture

When a remote `repo_url` is used, the server stores it as a **bare clone** under
the base directory (`<base-dir>/<repo-name>/`). On subsequent calls the same
clone is reused and refreshed with `git fetch --all --prune`; if the fetch fails
(e.g. the directory was deleted or corrupted) the clone is removed and recreated.

```
<base-dir>/
└── repo-name/              # Bare repository (no working tree)
    ├── objects/
    ├── refs/
    └── ...
```

There is **no worktree or checkout**. Every operation runs against the bare repo
and selects content via a tree-ish argument:

- `grep -n <pattern> <ref>`
- `ls-tree --name-only -r <ref>`
- `log <ref>`
- `blame <ref> -- <path>`
- `show <ref>[:<path>]`
- `diff <ref_from>..<ref_to>`

This is what makes branch-scoped queries cheap: switching `ref` from `main` to
`feat/x` requires no filesystem changes — only a different commit object is
walked.

Operations called without `repo_url` resolve to the current working directory's
git root via `git rev-parse --show-toplevel`; nothing is written under the base
directory in that mode.

## License

MIT
