---
description: Every function takes a single params object
whenToUse:
  - writing a function signature
  - reading the single-params-object lint error
relatedDocs:
  - coding__eslint-management
---

# Params Object Style

All function arguments must use object format.

```typescript
// Good
function createServer(params: { markdownDir: string; config: Config }): Server

// Bad
function createServer(markdownDir: string, config: Config): Server
```

This makes call sites more readable and allows easier extension.
