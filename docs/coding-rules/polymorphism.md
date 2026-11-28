---
description: Use polymorphism instead of conditional branching (if/switch), and implement interfaces with classes so the constructor absorbs what varies.
whenToUse:
  - Refactoring switch/if-else chains
  - Designing state machines
  - Implementing strategy patterns
  - Adding new variants to existing types
  - Deciding between a class and an object literal for an interface implementation
---

# Leveraging Polymorphism

Use polymorphism instead of conditional branching (if/switch), and avoid creating unnecessary branches.

## Implement interfaces with classes

**An interface implementation is a class, not an object literal.**

```typescript
// ❌ Object literal
export const mysqlDialect: Dialect = {
  quoteIdent(name) { ... },
};

// ❌ Factory returning a literal — the settings hide in a closure
export function ssmSource(config: SsmConfig): SecretSource {
  return { fetch: async (path) => ... };
}

// ✅ Class
export class MysqlDialect implements Dialect {
  quoteIdent(name: string): string { ... }
}

export class SsmSource implements SecretSource {
  constructor(private readonly config: SsmConfig) {}
  fetch = async (path: string): Promise<string | undefined> => { ... };
}
```

### Why

**The constructor is where the differences go.** What varies between implementations is settled at construction; the operation's signature stays the same for all of them. That split is what makes the interface usable:

```typescript
const sources: Record<string, SecretSource> = { env: new EnvSource(), ssm: new SsmSource(config) };
await sources[scheme].fetch(path);   // the caller does not know which one it has
```

Without it, per-instance settings tend to leak into the operation's parameters — and once `fetch(path, region)` exists, the interface can no longer be called through its own type. **An interface whose implementations cannot be driven through the interface is not an abstraction.**

Beyond that:

- `implements` states the contract at the declaration site, so a missing member is an error where the implementation is written, not where it is used
- It is mechanically checkable — see `custom/implement-interface-with-class`

### Declaring the operation

Prefer an arrow property over a method when the implementation is held behind its interface:

```typescript
// ❌ Method syntax — TypeScript checks parameters bivariantly
render(params: RenderParams): string;

// ✅ Property syntax — checked contravariantly under strict
render: (params: RenderParams) => string;
```

With method syntax, an implementation demanding more than the interface declares slips into a `Record<string, TheInterface>` unnoticed and fails at runtime. Property syntax rejects it at compile time.

### What this rule does not cover

Data is not an implementation. An object literal with no behaviour stays a literal:

```typescript
// ✅ Configuration, a DTO, a registry entry with no methods
const config: ServerConfig = { host: "localhost", port: 5432 };
```

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

## Registries

A registry is for the case where the selector arrives as runtime data — an operation id from an MCP client, a URI scheme from a config string. Type it as a total map so a missing implementation is a compile error:

```typescript
const LAYOUTS: Record<LayoutName, Layout> = { dagre: new DagreLayout(), ... };
```

When the implementation is chosen at wiring time instead, the caller holds the instance and no registry is needed. `Operation` holds its `ApprovalStrategy` rather than a name for one, so an op cannot be gated on a strategy nobody imported.

## Rationale

- Simplifies the calling code
- No changes needed on the calling side when adding new states
- TypeScript can detect missing implementations