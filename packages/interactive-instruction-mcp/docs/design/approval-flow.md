# Approval Flow Design

Rationale for the draft approval workflow.

**Related Specification:** `specification__draft-workflow`

## Problem

AI could create/modify documentation without user understanding the content.

## Solution: Force AI Explanation

### Why not show content automatically?

If tool shows content, AI can say "上記の内容で承認してください" without actually explaining.

### Why require self-review notes?

Forces AI to read and summarize content before explaining to user.

### Why show diff/summary after confirmation?

1. User already heard AI's explanation
2. Diff/summary serves as verification, not primary explanation
3. Notification is sent at this point - user can verify before approving

## Alternatives Considered

| Approach | Rejected Because |
|----------|-----------------|
| Show content at creation | AI skips explanation |
| No self-review | AI may not read content |
| Diff before explanation | User relies on diff, not AI |
