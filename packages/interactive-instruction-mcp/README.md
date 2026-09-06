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

**Seeing the corpus**
- `graph` — Render the `relatedDocs` graph as an interactive page, or return it as text
  (optional: `id`, `depth`, `includeUnlinked`, `layout`, `direction`, `spacing`, `edgeStyle`,
  `format`, `outputPath`)

### Looking at the relations

`relatedDocs` lives in frontmatter, which means the relations between documents are data rather
than prose — so they can be drawn:

```
instruction(action: "graph")                      → the whole corpus
instruction(action: "graph", id: "every-task", depth: 2)  → one document's neighbourhood
```

It writes an HTML file and returns the path; open it in a browser to pan, zoom, and hover a
node to fade everything that is not adjacent to it. Documents are coloured by their top-level
category, and **links pointing at documents that do not exist are drawn too**, as `(missing)`
— silently omitting them would make a broken corpus look intact.

`direction` (`TB` / `BT` / `LR` / `RL`) and `spacing` are passed to the layout. A document
corpus tends to be shallow and wide, so `LR` often reads better than the default `TB`.

`layout` accepts every layout `mcp-shared-graph-viz` offers apart from `preset`, which places
nodes where the caller says and so has nothing to offer here: `dagre` (default), `cose`,
`concentric`, `grid`, `circle`, `breadthfirst`, `fcose`, `cola`, `klay`, `cise`, `avsdf`,
`elk-layered`, `elk-mrtree`, `elk-stress`. `edgeStyle` (`bezier` by default, or `taxi`,
`segments`, `straight`, `haystack`) decides how edges are drawn; `taxi` takes its bearing from
`direction`, so a hierarchy does not need it stated twice.

Colours are assigned from the whole corpus rather than from the documents on screen, so a
category keeps its colour between the corpus graph and a close-up of one document.

Drawing is done by `mcp-shared-graph-viz`, which is given nodes and edges and knows nothing
about documents; the mapping from `relatedDocs` onto them lives here.

### The same graph as text

A page is for a person. A caller with no browser can ask for the graph itself:

```
instruction(action: "graph", format: "text")
```

```
34 documents, 36 relations

coding-rules__overview -> coding-rules__general, coding-rules__mcp-tool-design, coding-rules__typescript
coding-rules__mcp-tool-design -> coding-rules__handler-pattern, coding-rules__mcp-tool-approval, ...
every-task -> coding-rules__overview, trigger__rule-keyword, workflow__dry-principle, ...
```

One line per document that references anything, direction preserved, nothing written to disk.
On this repository's own documents that is about an eighth of the bytes of
`list(recursive: true)`, which carries every description and `whenToUse` alongside.

With `id`, the two questions being asked are answered before the adjacency list, so neither
has to be recovered by scanning it:

```
instruction(action: "graph", id: "coding-rules__mcp-tool-design", depth: 2, format: "text")
```

```
coding-rules__mcp-tool-design, depth 2

referenced by: coding-rules__overview
references: coding__mcp-tool-help-pattern, coding-rules__handler-pattern, ...

coding-rules__handler-pattern -> coding-rules__schema-sync
coding-rules__mcp-tool-design -> coding__mcp-tool-help-pattern, ...
every-task -> coding-rules__overview
```

`(missing)` links and, with `includeUnlinked`, documents with no relations are named on their
own lines rather than left to be inferred.

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
| `--include <id-prefix>` | Manage only documents under this prefix. Repeatable |
| `--exclude <id-prefix>` | Do not manage documents under this prefix. Repeatable, applied after `--include` |

### Sharing a directory with another tool

A documents directory is not always all one tool's. This repository's own `./docs` also holds
`chain/`, which belongs to a different MCP server — those files have their own frontmatter and
their own relation field, so every check made here reports them as broken. Before excluding
them, `lint` returned 223 issues; after `--exclude chain`, 38, and the error count went from 60
to 1.

```
mcp-interactive-instruction ./docs --exclude chain
```

Unmanaged documents are invisible: they do not appear in `list`, `lint`, backlinks or the
graph, `read` finds nothing, and a write that would touch one is refused with a reason rather
than quietly doing nothing. Prefixes are matched by whole id segments, so `--exclude chain`
takes `chain__adr__…` and leaves `chainsaw` alone.

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
