---
description: Code used in more than one place is extracted, not copied
whenToUse:
  - noticing the same code twice
  - deciding where shared code goes
  - reading a copied-content lint finding
relatedDocs:
  - coding__types
---

# Shared Code

Code used in multiple files must be extracted to common modules. Duplicate code is prohibited.

```typescript
// Good - shared utility
// src/utils/response-wrapper.ts
export function wrapResponse(params: {...}): ToolResult

// Bad - duplicated in each file
// src/tools/draft.ts
function wrapResponse(...) { ... }
// src/tools/apply.ts  
function wrapResponse(...) { ... }  // duplicate!
```
