---
whenToUse:
  - Reporting test or verification results to user
  - Summarizing what was checked and why it passed
  - Completing any task that requires validation
  - Documenting verification outcomes
---

# Verification Reporting

When reporting verification results to users, always explain **why** it's OK.

## Required Elements

1. **What was verified**: The specific behavior or requirement being checked
2. **Expected**: What should happen if working correctly
3. **Actual**: What actually happened
4. **Why OK**: Clear reasoning connecting expected to actual

## Format

```
### [Verification Name]

**Verified:** [specific behavior]
**Expected:** [what should happen]
**Actual:** [what happened]
**Verdict:** ✅ OK - [reason why actual matches expected]
```

## Examples

### Bad (unclear)

```
| Step | Status |
|------|--------|
| Create draft | ✅ |
| Approve | ✅ |
```

This tells the user nothing about what was actually checked.

### Good (clear reasoning)

```
### Token Required Before Apply

**Verified:** approve(confirmed: true) should NOT auto-apply
**Expected:** Workflow stops at pending_approval, waits for token
**Actual:** Response showed "desktop notification sent", asked for token
**Verdict:** ✅ OK - Document was not applied, token input required
```

## Why This Matters

- Users need confidence that verification actually checked correctness
- "✅" alone doesn't prove anything was verified
- Explicit reasoning catches false positives
- Future readers understand what behavior is guaranteed
- Applies to all tasks: testing, research, investigation, debugging
