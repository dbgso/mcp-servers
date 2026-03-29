---
description: YAML frontmatter format for document metadata (description and whenToUse).
---

# Frontmatter Format Specification

Documents can include YAML frontmatter at the file start to define metadata.

## Format

```markdown
---
description: Short description of the document (1-2 sentences, max 150 chars)
whenToUse:
  - When to use scenario 1
  - When to use scenario 2
---

# Document Title

Content...
```

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | No | Concise summary shown in document list |
| `whenToUse` | string[] | No | Situations when this document should be referenced |

> **Note**: `triggers` is supported as a legacy alias for `whenToUse` for backward compatibility.

## whenToUse Format

whenToUse can be specified in two ways:

```yaml
# Array format (recommended)
whenToUse:
  - Scenario 1
  - Scenario 2

# Inline format
whenToUse: [Scenario 1, Scenario 2]

# Single value
whenToUse: Single scenario
```

## Fallback Behavior

If no frontmatter is present, description is extracted from the first paragraph after the title.

## Display

In `help` tool output:
```
- **doc-id**: Description text
  - When to use: Scenario 1, Scenario 2, ...
```
