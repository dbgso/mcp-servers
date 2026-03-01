# Approval Notification Specification

When and how desktop notifications are sent.

## Notification Timing

See `specification__draft-workflow` for state definitions.

| Transition | Notification |
|------------|--------------|
| editing → self_review | ❌ No |
| self_review → user_reviewing | ❌ No |
| user_reviewing → pending_approval | ✅ **Yes** |
| pending_approval → applied | ❌ No |

## Notification Content

- **Operation**: "Draft Approval" or "Batch Draft Approval"
- **Description**: Draft ID(s) being approved
- **Token**: 4-digit code for validation

## Fallback

If desktop notification is missed:
```
/tmp/mcp-approval/pending.txt
```
