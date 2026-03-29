---
description: Guidelines for writing tests when fixing bugs to prevent regressions
whenToUse:
  - Fixing bugs or defects in the codebase
  - Writing tests for bug fixes
  - Ensuring regressions are prevented
---

# Bug Fix Testing Rule

When fixing discovered bugs, always ensure the fix is covered by test code.

## Rules

1. **Write tests before fixing** - Write tests that reproduce the bug first
2. **Confirm tests fail** - Verify that tests fail before the fix
3. **Implement the fix** - Fix the bug
4. **Confirm tests pass** - Verify that tests pass after the fix

## Rationale

- Prevents the same bug from recurring
- Proves that the fix is correct
- Functions as a regression test

## Example

```typescript
// Bug: self_review→pending_explanation succeeds without notes
it("should fail without notes", async () => {
  const result = await instance.trigger({
    params: { action: "review_complete" },  // No notes
  });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("notes");
});
```
