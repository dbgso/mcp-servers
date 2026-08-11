# File Structure Specification

This document describes the file structure used by interactive-instruction-mcp for managing documentation drafts.

## Base Directory

The base directory is configured at MCP server startup. All draft and confirmed documents are stored relative to this directory.

## Directory Layout

```
docs/                    # base directory
├── _mcp_drafts/         # draft documents
│   ├── overview.md
│   └── specification/
│       └── draft-workflow.md
├── overview.md          # confirmed documents
└── specification/
    └── draft-workflow.md
```

## Draft Directory

- Location: `_mcp_drafts/` under base directory
- Purpose: Stores documents awaiting approval
- File naming: Preserves the target path structure

## Confirmed Documents

- Location: Directly under base directory
- Purpose: Approved, production-ready documentation
- Access: Available via `help` and `description` tools

## Approval Flow

When a draft is approved, it moves from the draft directory to the confirmed location:

```
_mcp_drafts/X.md → X.md
```

For nested paths:
```
_mcp_drafts/specification/draft-workflow.md → specification/draft-workflow.md
```

See [specification__draft-workflow](specification__draft-workflow.md) for detailed approval process.
