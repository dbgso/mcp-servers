---
whenToUse:
  - Writing new code
  - Refactoring existing code
  - Reviewing code quality
  - Learning project coding standards
---

# Coding Standards

A collection of fundamental rules for writing maintainable and readable code.

## Basic Principles

### DRY (Don't Repeat Yourself)
- Don't repeat the same code
- Extract common logic into functions/modules

### KISS (Keep It Simple, Stupid)
- Strive for simple implementations
- Break down complex logic to make it easier to understand

### YAGNI (You Aren't Gonna Need It)
- Don't implement until it's needed
- Avoid over-engineering based on future assumptions

## Naming Conventions

- Use meaningful names (specific names rather than `data` or `temp`)
- Follow consistent naming conventions (camelCase, snake_case, etc.)
- Avoid abbreviations; prioritize readability
- Start function names with verbs (`getUserName`, `calculateTotal`)
- Start boolean values with `is`, `has`, `can`

## Function Design

- Single Responsibility Principle (one function does one thing)
- Keep functions short (guideline: within 20-30 lines)
- Keep arguments minimal (ideally 3 or fewer)
- Minimize side effects

### Extract Conditional Chains as Pure Functions

When you have logic that determines output based on input through conditional branches, extract it as a pure function:

**Before** (inline conditional chain):
```typescript
let name = "";
let kind = "unknown";
if (Node.isInterfaceDeclaration(decl)) {
  name = decl.getName();
  kind = "interface";
} else if (Node.isClassDeclaration(decl)) {
  name = decl.getName() ?? "anonymous";
  kind = "class";
} else {
  name = fallback;
  kind = decl.getKindName();
}
```

**After** (extracted pure function):
```typescript
// Pure function - testable, reusable, named
function getDeclarationInfo(params: { node: Node; fallbackName?: string }): { name: string; kind: string } {
  const { node, fallbackName } = params;
  if (Node.isInterfaceDeclaration(node)) {
    return { name: node.getName(), kind: "interface" };
  }
  if (Node.isClassDeclaration(node)) {
    return { name: node.getName() ?? "anonymous", kind: "class" };
  }
  return { name: fallbackName ?? "unknown", kind: node.getKindName() };
}

// Usage
const { name, kind } = getDeclarationInfo({ node: decl, fallbackName });
```

**Benefits**:
1. **Testability**: Pure functions are easy to unit test without mocking
2. **Reusability**: Can be called from multiple places
3. **Readability**: Logic has a descriptive name

**Applies to**:
- `if/else if` chains
- `switch` statements
- Type discrimination logic
- Mapping/transformation logic

## Error Handling

- Detect errors early and handle them appropriately
- Include specific and useful information in error messages
- Don't forget to check for null and undefined

## Comments

- Express in code what can be expressed in code
- Write comments that explain "why" (not "what")
- Delete or update outdated comments

## Testing

- Write testable code
- Test boundary values and edge cases
- Make test names clearly describe what is being tested
