---
whenToUse:
  - Writing if statements with complex conditions
  - Adding guard clauses
  - Reviewing code for readability
  - Documenting conditional logic
---

# If Statement Comments

Add a summary comment on the line immediately before each if statement explaining the condition, except when the condition is self-evident.

## Format

```typescript
// Guard: <condition summary>
if (condition) {
  ...
}
```

## Examples

```typescript
// Guard: Required parameters must be provided
if (!id || !status) {
  return { isError: true, ... };
}

// Guard: Task must exist in the plan
if (!task) {
  return { isError: true, ... };
}

// Only show output for completed tasks
if (status !== "completed") {
  return "";
}
```

## When to skip

Self-evident conditions don't need comments:

```typescript
// No comment needed - condition is obvious
if (tasks.length === 0) {
  return "No tasks.";
}

if (!result.success) {
  return { isError: true, text: result.error };
}
```

## Why

- Makes code self-documenting
- Easier to understand complex conditions at a glance
- Helps during code review
