---
whenToUse:
  - Writing conditional logic
  - Refactoring nested if-else statements
  - Implementing guard clauses
  - Reviewing code with deep nesting
---

# Early Return Pattern

Use early returns from methods/functions instead of `let` or ternary operators in conditional logic.

## Bad Examples

```typescript
// ❌ let + if-else
let result: string;
if (condition) {
  result = "value1";
} else {
  result = "value2";
}
return result;

// ❌ Ternary operator (when complex)
const result = condition1
  ? value1
  : condition2
    ? value2
    : value3;
```

## Good Examples

```typescript
// ✅ Early return
function getValue(condition: boolean): string {
  if (condition) {
    return "value1";
  }
  return "value2";
}

// ✅ Guard clauses
async function validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
  if (!this.allowedTransitions.includes(ctx.newStatus)) {
    return {
      allowed: false,
      error: `Cannot transition...`,
    };
  }

  if (!ctx.params.comment) {
    return {
      allowed: false,
      error: `Feedback required...`,
    };
  }

  return { allowed: true };
}
```

## Rationale

- Improves code readability (reduces nesting depth)
- Each condition's processing is clearly separated
- Avoids variable reassignment with `let`
