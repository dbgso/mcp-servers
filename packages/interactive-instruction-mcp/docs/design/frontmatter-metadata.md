---
description: Why the metadata lives in frontmatter rather than in the body or a side file
whenToUse:
  - questioning where metadata belongs
  - adding a metadata key
relatedDocs:
  - specification__frontmatter-format
approvedAt: 2026-09-27T03:05:34.816Z
---

# Frontmatter Metadata Design

## Problem

Documents need metadata (description, when to use) that:
1. Is visible in document listings
2. Helps AI decide which document to read
3. Doesn't require parsing document body

## Solution: YAML Frontmatter

Adopted standard YAML frontmatter format (used by Claude Code skills, Jekyll, Hugo, etc.):

```markdown
---
description: ...
whenToUse:
  - ...
---
```

## Why Frontmatter

| Approach | Pros | Cons |
|----------|------|------|
| First paragraph | No extra syntax | Limited to description only |
| HTML comments | Invisible in rendered view | Non-standard for metadata |
| **Frontmatter** | Standard, extensible, tooling support | Requires parser |

## Implementation

1. **Parser**: Simple regex-based YAML parser (`frontmatter-parser.ts`)
2. **Fallback**: If no frontmatter, extract description from first paragraph
3. **Display**: Show whenToUse as "When to use" in help output

## read_meta Tool

Added `read_meta` tool that returns a prompt for AI to generate/update metadata:
- Shows current metadata
- Shows document content
- Provides instructions for generating description and whenToUse
