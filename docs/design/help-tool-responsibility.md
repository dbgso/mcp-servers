---
description: Responsibility boundaries for help tool and the problem of AI not reading documentation.
whenToUse:
  - Understanding help tool design
  - Investigating why AI doesn't read docs
  - Clarifying responsibility boundaries
---

# Help Tool Responsibility Boundaries

## Problem Patterns

### Pattern A: AI ignores CLAUDE.md

- Does not use help tool at all
- Ignores "use help" instruction in CLAUDE.md

**Conclusion**: Out of scope for tool providers. This is an AI model/framework issue.

### Pattern B: Uses help but doesn't select appropriate docs

- Executes help but doesn't read relevant documents
- Can be improved with description/whenToUse

**Conclusion**: Can be improved if operators maintain proper metadata.

## Responsibility Boundaries

```
┌─────────────────────────────────────────────────────┐
│  Operator (Document Author) Responsibility          │
│  - Write proper instructions in CLAUDE.md          │
│  - Maintain description/whenToUse metadata         │
│  - Create quality document content                 │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  MCP Tool Provider Responsibility                   │
│  - Provide help tool mechanism                     │
│  - Implement metadata-based suggestion feature     │
│  - Provide guidelines/templates                    │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  AI Model/Host Responsibility (Out of our control) │
│  - Follow CLAUDE.md instructions                   │
│  - Select and execute tools appropriately          │
│  - Prioritize context correctly                    │
└─────────────────────────────────────────────────────┘
```

## What Tool Providers CAN Do

1. **Provide help tool mechanism** ✅
2. **Provide description/whenToUse mechanism** ✅
3. **Provide guidelines/templates** - Show how to write metadata
4. **Document responsibility boundaries** - This document

## What Tool Providers CANNOT Do

- Force AI to read CLAUDE.md
- Force AI to use help tool
- Intervene in AI's decision-making process

## Guidelines for Operators

### How to write description

```yaml
description: Brief one-line summary of what the document does
```

- Include specific actions
- Use searchable keywords

### How to write whenToUse

```yaml
whenToUse:
  - Specific scenario 1
  - Specific scenario 2
```

- Be specific, not abstract
- Write conditions that AI can easily judge

### Example

```yaml
---
description: Use AST tools for TypeScript coding (investigation and modification).
whenToUse:
  - TypeScript code investigation
  - Function signature refactoring
  - Large-scale code changes (3+ locations)
---
```