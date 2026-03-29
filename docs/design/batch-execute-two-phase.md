---
description: batch_execute uses position-based two-phase execution to handle line number drift and node invalidation in AST transformations.
whenToUse:
  - Understanding how batch_execute handles multiple AST transformations
  - Debugging line number drift issues in AST operations
  - Implementing new batch transformation tools in ast-typescript-mcp
  - Understanding why Node references become invalid after replaceText
globs: ["packages/ast-typescript-mcp/**"]
---

# batch_execute Two-Phase Execution

The batch_execute tool uses a Position-based Two-Phase approach to safely apply multiple AST transformations at once.

## Problem

When applying multiple AST transformations in sequence:

1. **Line Number Drift**: First transformation adds/removes lines → subsequent line numbers become invalid
2. **Node Invalidation**: `sourceFile.replaceText()` invalidates ALL Node references in that file

## Solution: Position-Based Two-Phase Execution

### Phase 1: Prepare (Collect Text Positions)

```typescript
interface PreparedTransform {
  start: number;    // Text position start
  end: number;      // Text position end
  newText: string;  // Replacement text
}
```

- Call `prepareTransform()` for each operation
- Captures positions BEFORE any modifications
- Does NOT hold Node references (they become invalid)

### Phase 2: Apply (Bottom-Up)

- Sort by `start` position DESCENDING (bottom of file first)
- Apply `replaceText([start, end], newText)` in order
- Bottom-up ensures earlier changes don't shift later positions

## Why Not Node References?

Initial approach tried collecting Node objects:

```typescript
// Phase 1
const nodeA = findCallAtLine(3);
const nodeB = findCallAtLine(4);

// Phase 2
applyToNode(nodeA);  // OK - calls replaceText()
applyToNode(nodeB);  // ERROR: "Node reference is no longer valid"
```

**ts-morph limitation**: `replaceText()` invalidates ALL nodes in the same SourceFile.

## Implementation

Each transform tool provides:

```typescript
// Returns positions + replacement text (no Node reference)
prepareTransform(sourceFile, line, column, params): PreparedTransform | { error }
```

batch_execute orchestrates:

```typescript
// Phase 1: Collect all positions
for (const op of operations) {
  prepared.push(tool.prepareTransform(...));
}

// Phase 2: Apply bottom-up
const sorted = prepared.sort((a, b) => b.start - a.start);
for (const transform of sorted) {
  sourceFile.replaceText([transform.start, transform.end], transform.newText);
}
```

## Benefits

- **Line Number Drift**: Solved by collecting all positions first
- **Node Invalidation**: Solved by using positions, not Node references
- **Atomicity**: All operations prepared before any changes applied
- **Preview Mode**: Can return changes without applying
