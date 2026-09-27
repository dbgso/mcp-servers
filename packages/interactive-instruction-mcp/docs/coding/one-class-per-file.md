---
description: One class per file, and how files are named
whenToUse:
  - adding a class
  - splitting a file that grew
---

# File Structure

Basic principle: one file per class.

## Example

```
src/tools/draft/
  handlers/
    list-handler.ts
    read-handler.ts
    add-handler.ts
  index.ts
```

Not:
```
src/tools/draft.ts  // Contains multiple classes
```
