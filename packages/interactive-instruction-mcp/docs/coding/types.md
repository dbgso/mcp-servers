---
description: Types and interfaces live in shared files, not inline in implementations
whenToUse:
  - declaring a type
  - deciding where an interface belongs
---

# Type Definitions

Type and interface definitions should be placed in common files, not inline in implementation files.

## Location

- `src/types/index.ts` - Common types used across the project

## Example

```typescript
// Bad - inline in implementation file
// src/tools/draft.ts
interface DraftActionHandler { ... }

// Good - in common types file
// src/types/index.ts
export interface ActionHandler { ... }
```
