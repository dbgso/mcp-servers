# Draft ID Format Specification

This document defines the format rules for draft IDs used in the interactive-instruction-mcp package.

## ID Format Rules

Draft IDs must follow these rules:

| Rule | Description | Valid | Invalid |
|------|-------------|-------|---------|
| Characters | Alphanumeric, hyphens, underscores only | `my-draft_01` | `my draft!` |
| Case | Lowercase recommended | `api-design` | `API-Design` |
| Length | Non-empty, reasonable length | `overview` | (empty string) |
| Start/End | Should start/end with alphanumeric | `my-draft` | `-draft-` |

## Hierarchy Separator

The double underscore (`__`) is used as a hierarchy separator. It maps directly to `/` in the file path.

| ID | File Path |
|----|-----------|
| `overview` | `overview.md` |
| `specification__draft-workflow` | `specification/draft-workflow.md` |
| `design__approval-flow` | `design/approval-flow.md` |
| `api__v2__endpoints` | `api/v2/endpoints.md` |

## Reserved Prefixes

| Prefix | Purpose |
|--------|---------|
| `_mcp_drafts__` | Auto-added for draft files. Drafts are stored in `docs/_mcp_drafts/` directory. |

When you create a draft with ID `specification__draft-id-format`, the file is stored at:
```
docs/_mcp_drafts/specification/draft-id-format.md
```

## File Extension

The `.md` extension is always auto-added. Do not include it in the ID.

| Input ID | Resulting File |
|----------|----------------|
| `overview` | `overview.md` |
| `overview.md` | `overview.md.md` (incorrect) |

## Examples

### Simple ID
```
ID: overview
Path: docs/_mcp_drafts/overview.md
```

### Nested ID
```
ID: specification__draft-workflow
Path: docs/_mcp_drafts/specification/draft-workflow.md
```

### Deeply Nested ID
```
ID: design__patterns__approval-flow
Path: docs/_mcp_drafts/design/patterns/approval-flow.md
```
