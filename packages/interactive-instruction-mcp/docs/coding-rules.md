---
description: Index of this package's coding conventions
whenToUse:
  - writing code here
  - reviewing a change
  - looking for the rule that applies
relatedDocs:
  - coding__service-layer
  - coding__one-class-per-file
  - coding__params-style
  - coding__polymorphism
  - coding__shared-code
  - coding__types
  - coding__validation-extraction
  - coding__eslint-management
  - documentation__language
---

# Coding Rules

This project's coding conventions and rules.

## Function/Method Arguments

All custom functions and methods should use params object style:

```typescript
// Good
function createServer(params: { markdownDir: string; config: ReminderConfig }): McpServer

// Bad
function createServer(markdownDir: string, config: ReminderConfig): McpServer
```

This makes the call site more readable and allows for easier extension.
