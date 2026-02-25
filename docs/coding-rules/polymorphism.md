---
whenToUse:
  - Refactoring switch/if-else chains
  - Designing state machines
  - Implementing strategy patterns
  - Adding new variants to existing types
---

# Leveraging Polymorphism

Use polymorphism instead of conditional branching (if/switch), and avoid creating unnecessary branches.

## Bad Examples

```typescript
// ❌ Optional method + null check
interface TaskState {
  getEntryMessage?(task: Task): string;  // Optional
}

// Branching required on the calling side
const message = state.getEntryMessage
  ? state.getEntryMessage(task)
  : "";

// ❌ Branching by type
if (status === "pending_review") {
  return getPendingReviewMessage(task);
} else if (status === "in_progress") {
  return getInProgressMessage(task);
}
```

## Good Examples

```typescript
// ✅ Required method + default implementation
interface TaskState {
  getEntryMessage(task: Task): string;  // Required
}

// States that don't need a message return empty string
class PendingState implements TaskState {
  getEntryMessage(_task: Task): string {
    return "";
  }
}

// States that need a message implement it
class PendingReviewState implements TaskState {
  getEntryMessage(task: Task): string {
    return `🛑 STOP - Task "${task.id}" needs review...`;
  }
}

// No branching needed on the calling side
const message = stateRegistry[status].getEntryMessage(task);
```

## Rationale

- Simplifies the calling code
- No changes needed on the calling side when adding new states
- TypeScript can detect missing implementations
