---
description: Where the server writes, and which directories each action looks at
whenToUse:
  - locating a draft or a state file on disk
  - deciding whether an action should reach a draft
  - sharing a documents directory with another tool
---

# File Structure Specification

Where this server puts things, and which of them it will look at again.

## Inside the documents directory

```
docs/                       # the directory given on the command line
├── _mcp_drafts/            # drafts, created on the first `add`
│   ├── overview.md
│   └── specification/
│       └── draft-workflow.md
├── overview.md             # promoted documents
└── specification/
    └── draft-workflow.md
```

`__` in an id is a directory separator on disk, so `specification__draft-workflow`
is `specification/draft-workflow.md`. Promotion moves the file out of
`_mcp_drafts/` to the same path relative to the base directory.

**Nothing is created at startup.** An earlier version wrote an approval-format
document into the corpus before anything had been called; that document is gone
and the format it carried is part of the `approve` response instead.

## Outside the documents directory

State that is not documentation does not live among the documents. Each is
scoped per documents directory, so two servers on one machine do not share it,
and each is overridable:

| What | Environment variable |
|------|----------------------|
| Draft workflow state | `MCP_DRAFT_PERSIST_DIR` |
| Staged updates awaiting `apply` | `MCP_INSTRUCTION_PENDING_DIR` |
| Diff files shown by `update` | `MCP_INSTRUCTION_DIFF_DIR` |

## What each action considers a document

`_mcp_drafts/` is the one internal directory. Which actions reach into it is
decided by the nature of the operation, not by where the file sits:

| | Draft | Promoted |
|---|---|---|
| `read`, `read_meta`, `update`, `link_add`, `link_remove`, `rename`, `delete` | yes | yes |
| `approve`, `set_status` | yes | not applicable |
| `apply`, `cancel` | not applicable | yes |
| `lint`, a document's own rules (size, repeated headings, missing metadata) | yes | yes |
| `lint`, corpus-wide rules (orphans, similarity, copied passages, cycles) | no | yes |
| `list` | `drafts: true` only | by default |
| `graph` | no | yes |

An action that does not cover a state says so, and does not report the document
as missing.

## Scoping a shared directory

`--include` and `--exclude` say which ids in the directory this server manages,
for a directory it shares with another tool. A document out of scope is invisible
to every action: it does not appear in `list`, `lint`, backlinks or the graph,
and it cannot be written.
