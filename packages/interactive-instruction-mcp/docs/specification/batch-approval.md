# Batch Approval Specification

Approve multiple drafts with a single token.

## Usage

```
draft(action: "approve", ids: "id1,id2,id3", approvalToken: "<token>")
```

## Requirements

All drafts must be in `pending_approval` state. See `specification__draft-workflow`.

## Current Behavior

| Step | Action | Notifications |
|------|--------|---------------|
| 1 | Each draft: `approve(confirmed: true)` | N (1 per draft) |
| 2 | `approve(ids: "...", approvalToken: "...")` | 0 |

**Total notifications:** N (for N drafts)

## Planned Behavior

| Step | Action | Notifications |
|------|--------|---------------|
| 1 | `approve(ids: "...", confirmed: true)` | 1 |
| 2 | `approve(ids: "...", approvalToken: "...")` | 0 |

**Total notifications:** 1

See `design__batch-notification` for rationale.
