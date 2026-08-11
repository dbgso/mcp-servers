# mcp-interactive-instruction

MCP server for interactive instruction documents. AI agents discover usage through tool responses, not pre-loaded documentation.

## Design Philosophy

- **Learn by doing**: AI calls `instruction_describe()` to learn available actions, then uses `instruction()` with guided responses
- **Single source of truth**: Each handler defines its own schema — no manual sync needed
- **Human oversight**: Draft operations are free, promoted document changes require approval

## Tools

Only 2 tools. AI discovers everything through responses.

| Tool | Purpose |
|------|---------|
| `instruction_describe` | Show usage instructions and available actions |
| `instruction` | Execute actions (list, read, add, update, delete, etc.) |

### Quick Start

```
instruction_describe()     → Learn all available actions
instruction()              → Show available action list
instruction(action: "list") → List all documents
instruction(action: "read", id: "doc-id") → Read a document
```

### Available Actions

**Reading**
- `list` — List documents (optional: `id`, `recursive`, `query`, `missingMeta`, `backlinks`)
- `read` — Read a document by ID

**Draft Operations**
- `add` — Create a new draft (`id`, `content`, `description`, `whenToUse` required)
- `update` — Update a draft (direct) or promoted document (pending + apply/cancel)
- `delete` — Delete a draft (instant) or promoted document (approval required)
- `rename` — Rename a draft (instant) or promoted document (approval required)

**Approval Workflow**
- `approve` — Progress through: notes → confirmed → token (optional: `targetId`, `force`, `ids` for batch)

**Pending Updates** (for promoted document updates via `update`)
- `apply` — Apply a pending update
- `cancel` — Cancel a pending update

**Metadata & Quality**
- `link_add` / `link_remove` — Manage related document links
- `lint` — Check document quality
- `set_status` — Set draft workflow status (single `id` or batch `ids`)
- `update_meta` — Generate metadata update prompt (`id` only)

### Draft vs Promoted

| | Draft | Promoted |
|---|---|---|
| Location | `_mcp_drafts/` | Root directories |
| Create/Update/Delete | Free | Requires approval |
| Approval workflow | add → approve (notes → confirmed → token) | N/A |

### Approval Workflow

```
1. instruction(action: "add", id: "new-doc", content: "...", description: "...", whenToUse: [...])
2. instruction(action: "approve", id: "new-doc", notes: "<self-review>")
3. [AI explains to user]
4. instruction(action: "approve", id: "new-doc", confirmed: true)
5. [User provides token]
6. instruction(action: "approve", id: "new-doc", approvalToken: "<token>")
```

## Installation

```bash
npm install -g mcp-interactive-instruction
```

## Configuration

### Claude Code

`.mcp.json` in project root:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "mcp-interactive-instruction", "./docs"]
    }
  }
}
```

### Reminder Flags (Optional)

Optionally add flags to help AI remember to use the MCP tools:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-interactive-instruction",
        "./docs",
        "--remind-mcp",
        "--remind-organize",
        "--reminder", "Always check tests before committing"
      ]
    }
  }
}
```

| Flag | Effect |
|------|--------|
| `--remind-mcp` | Reminds AI to check docs before starting tasks |
| `--remind-organize` | Reminds AI to keep docs organized (1 topic per file) |
| `--reminder <message>` | Add custom reminder message (can be used multiple times) |
| `--topic-for-every-task <id>` | Specify a document AI must re-read before every task |
| `--info-expires <seconds>` | How long MCP info stays valid (default: 60). Works with `--topic-for-every-task` |

### Topic for Every Task

Force AI to re-read a specific document before every task. Useful for critical rules that should never be forgotten:

```json
{
  "args": [
    "-y",
    "mcp-interactive-instruction",
    "./docs",
    "--topic-for-every-task", "every-task",
    "--info-expires", "60"
  ]
}
```

**Best Practice:** Keep the topic-for-every-task document as a **redirect hub** rather than a detailed rule list:

```markdown
# Every Task

Read these documents before starting any task:

- `coding-rules` - Essential coding conventions
- `workflow` - Required workflow steps
```

**Tuning `--info-expires`:**

| Value | Effect |
|-------|--------|
| 30-60s | Frequent re-reads, higher context usage |
| 120-300s | Balanced approach |
| 600s+ | Rare re-reads, lower context usage |

## Directory Structure

```
docs/
├── coding-style.md              → id: "coding-style"
├── git/
│   ├── workflow.md              → id: "git__workflow"
│   └── commands.md              → id: "git__commands"
└── _mcp_drafts/                 ← AI's temporary drafts
    └── coding/
        └── testing.md           → draft id: "coding__testing"
```

- **Confirmed docs**: Root level and subdirectories (excluding `_mcp_drafts/`)
- **Drafts**: Stored in `_mcp_drafts/` directory
- **ID format**: Use `__` (double underscore) as the path separator

## Document Format

```markdown
---
description: Short summary of this document
whenToUse:
  - When doing X
  - When doing Y
relatedDocs:
  - other-doc-id
---

# Title

Content...
```

Frontmatter metadata (`description`, `whenToUse`) is used for search and listing. The `add` action generates this automatically.

### Granularity Guidelines

Keep each document focused on **ONE topic**:

| Instead of | Split into |
|------------|------------|
| `git.md` (everything) | `git__workflow.md` + `git__commands.md` |
| `coding.md` (all rules) | `coding__style.md` + `coding__testing.md` |

**Why this matters:**
- AI loads only what's needed
- Easier to find and update specific information
- Better summaries for matching

## Workflow

### For AI

1. **Check docs before tasks**: Use `instruction(action: "list")` to see available documentation
2. **Record new learnings**: When user teaches something new, immediately create a draft
3. **One topic per file**: Keep drafts focused and granular
4. **Follow approval flow**: add → approve (notes → explain → confirmed → token)

### For Users

1. **Review drafts**: Check what AI has recorded
2. **Approve or reject**: Provide tokens for approved changes
3. **Organize**: Use `rename` to reorganize document structure

## Performance

- **Caching**: Document list cached for 1 minute
- **Cache invalidation**: Automatic on write operations
- **Lazy loading**: Documents read only when requested

## License

MIT
