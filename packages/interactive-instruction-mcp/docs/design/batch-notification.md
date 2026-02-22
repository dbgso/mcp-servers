# Batch Notification Design

Rationale for batch approval notification improvement.

**Related Specifications:**
- `specification__batch-approval`
- `specification__approval-notification`

## Problem

When approving N drafts, user receives N+1 notifications:
- N from individual `confirmed: true` calls
- 1 from batch approve call

## Root Cause

`confirmed: true` triggers notification per draft because:
1. Each draft transitions `user_reviewing → pending_approval` independently
2. Transition sends notification immediately

## Solution

Add `ids` support to `confirmed: true`:

```
draft(action: "approve", ids: "a,b,c", confirmed: true)
```

This will:
1. Transition all drafts in single operation
2. Send 1 notification for all

## Implementation

Modify `handleBatchApproval` to accept `confirmed` parameter:
- If `confirmed: true`: transition all from `user_reviewing`, send 1 notification
- If `approvalToken`: validate and apply all
