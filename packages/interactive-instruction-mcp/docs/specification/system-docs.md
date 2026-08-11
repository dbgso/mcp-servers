# Auto-Generated Files Specification

Files and directories created automatically by the MCP server.

## Startup (Server Init)

| Path | Purpose | Condition |
|------|---------|-----------|
| `{docsDir}/_mcp-interactive-instruction/` | System docs directory | Always |
| `{docsDir}/_mcp-interactive-instruction/draft-approval.md` | Workflow rules | If missing |

**Rationale:** Code references this document (hardcoded), so it must exist.

**Source:** `src/services/system-docs.ts`

## On Demand (Draft Operations)

| Path | Purpose | Trigger |
|------|---------|---------|
| `{docsDir}/_mcp_drafts/` | Draft storage | First `draft(action: "add")` |
| `{docsDir}/_mcp_drafts/{id}.md` | Draft file | `draft(action: "add")` |

**Rationale:** AI can autonomously create documents, but user approval is required for promotion to confirmed docs.

**Source:** `src/services/markdown-reader.ts`

## On Demand (Approval)

| Path | Purpose | Trigger |
|------|---------|---------|
| `/tmp/mcp-approval/` | Approval token storage | First approval request |
| `/tmp/mcp-approval/pending.txt` | Pending tokens | `draft(action: "approve", confirmed: true)` |

**Rationale:** Fallback for missed desktop notifications or checking multiple pending approvals at once.

**Source:** `mcp-shared/src/utils/approval.ts`

### pending.txt Format

Multiple entries are appended, separated by `---`:

```
MCP Approval Required
=====================
Operation: Draft Approval
Description: Approve draft "spec-1"
Token: 1234
Expires: 4:00:00 PM
ID: draft-approve-spec-1

---
MCP Approval Required
=====================
Operation: Draft Approval
Description: Approve draft "spec-2"
Token: 5678
Expires: 4:00:05 PM
ID: draft-approve-spec-2

---
```

## Behavior

| Condition | Action |
|-----------|--------|
| Directory missing | Create with `mkdir -p` |
| File missing | Create with content |
| File exists | Append new entry |
