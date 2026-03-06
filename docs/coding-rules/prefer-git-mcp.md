---
description: Prefer git-repo-explorer-mcp tools over bash git commands for read-only operations.
whenToUse:
  - Viewing git history or logs
  - Searching code in repository
  - Checking file contents at specific commits
  - Listing branches or tags
  - Running git blame
  - Comparing diffs between refs
relatedDocs:
  - coding-rules__mcp-tool-design
  - coding-rules__mcp-tool-approval
---

# Git MCP Priority

Prefer git-repo-explorer-mcp tools over bash git commands for read-only operations.

## Why

- **Structured output**: MCP tools return structured data, easier to process
- **Consistency**: Unified interface across different git operations
- **Safety**: All operations are read-only by design

## Available Operations

| Operation | Use Instead Of |
|-----------|----------------|
| `git_execute({ operation: "log" })` | `git log` |
| `git_execute({ operation: "diff" })` | `git diff` |
| `git_execute({ operation: "blame" })` | `git blame` |
| `git_execute({ operation: "show" })` | `git show` |
| `git_execute({ operation: "grep" })` | `git grep` |
| `git_execute({ operation: "ls_files" })` | `git ls-files` |
| `git_execute({ operation: "branch_list" })` | `git branch` |
| `git_execute({ operation: "tag_list" })` | `git tag` |

## When to Use Bash Git

Use bash git commands only for:
- **Write operations**: `git add`, `git commit`, `git push`, `git checkout`
- **Interactive operations**: `git rebase -i`
- **Complex pipelines**: When combining multiple git commands

## Example

```typescript
// Good: Use MCP for read operations
const log = await git_execute({ operation: "log", params: { limit: 10 } });
const diff = await git_execute({ operation: "diff", params: { ref1: "HEAD~1", ref2: "HEAD" } });

// Good: Use bash for write operations
await bash("git add . && git commit -m 'feat: add feature'");
```