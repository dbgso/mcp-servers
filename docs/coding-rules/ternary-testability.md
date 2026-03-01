---
whenToUse:
  - Writing conditional expressions
  - Improving test coverage
  - Refactoring ternary operators
  - Making code more testable
---

# Ternary Operators and Testability

Ternary operators are concise but can make test coverage difficult. Extract to functions to improve testability.

## Problem

Covering both branches of a ternary operator in tests can be challenging.

```typescript
// Hard to cover both branches
const feedbackPart = feedbackSection ? `\n${feedbackSection}\n` : "";
```

## Recommendation: Extract to Function

Extract conditional logic into functions for better testability.

```typescript
// Good: Extract to function for testability
function formatFeedbackPart(feedbackSection: string): string {
  if (!feedbackSection) return "";
  return `\n${feedbackSection}\n`;
}

const feedbackPart = formatFeedbackPart(feedbackSection);
```

## Benefits

1. **Testability**: Function can be unit tested independently
2. **Readability**: Intent becomes clearer
3. **Reusability**: Same logic can be used in multiple places
4. **Coverage**: Each branch can be explicitly tested

## Exceptions

Simple assignments or non-critical code can use ternary:
```typescript
const displayName = name || "Anonymous";  // OK: simple
```
