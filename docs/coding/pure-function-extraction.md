---
description: Extract shared logic as pure functions and always write tests for them.
whenToUse:
  - Duplicated logic in multiple places
  - Extracting common functionality
  - Refactoring for reusability
---

# Pure Function Extraction

When extracting shared logic, always create pure functions with tests.

## Rule

1. **Extract as pure function**: No side effects, same input always produces same output
2. **Write unit tests**: Pure functions must have corresponding tests

## Why Pure Functions?

- **Testable**: Easy to test with simple input/output assertions
- **Predictable**: No hidden state or side effects
- **Reusable**: Safe to use anywhere without unexpected behavior

## Example

### Before (duplicated logic)

```typescript
// file-a.ts
const line = `- **${doc.id}**: ${doc.description}`;
if (doc.whenToUse?.length > 0) {
  line += `\n  - When to use: ${doc.whenToUse.join(", ")}`;
}

// file-b.ts  
const line = `- **${d.id}**: ${d.description}`;
if (d.whenToUse?.length > 0) {
  line += `\n  - When to use: ${d.whenToUse.join(", ")}`;
}
```

### After (pure function + test)

```typescript
// string-utils.ts
export function formatDocumentListItem(params: {
  id: string;
  description: string;
  whenToUse?: string[];
}): string {
  const { id, description, whenToUse } = params;
  let line = `- **${id}**: ${description}`;
  if (whenToUse && whenToUse.length > 0) {
    line += `\n  - When to use: ${whenToUse.join(", ")}`;
  }
  return line;
}

// string-utils.test.ts
describe("formatDocumentListItem", () => {
  it("formats document with description only", () => {
    expect(formatDocumentListItem({
      id: "test",
      description: "Test desc",
    })).toBe("- **test**: Test desc");
  });

  it("formats document with whenToUse", () => {
    expect(formatDocumentListItem({
      id: "test",
      description: "Test desc",
      whenToUse: ["A", "B"],
    })).toBe("- **test**: Test desc\n  - When to use: A, B");
  });
});
```