---
whenToUse:
  - Writing or updating help documents
  - Considering whether to duplicate content
  - Deciding where to place shared information
  - Reviewing documentation for redundancy
---

# DRY Principle

Don't Repeat Yourself. Define information in one place, reference it elsewhere.

## Rule

- **Single source of truth**: Each concept should have one authoritative location
- **Reference, don't copy**: Link to the source instead of duplicating content
- **Update once**: When information changes, only one place needs updating

## Application to Help Documents

### Bad (duplication)

```markdown
## every-task.md
When reporting results, always explain why it's OK.
Include: what was verified, expected, actual, verdict.

## some-other-doc.md
When reporting results, always explain why it's OK.
Include: what was verified, expected, actual, verdict.
```

### Good (reference)

```markdown
## every-task.md
- **Verification Reporting**: See `workflow__verification-reporting`

## some-other-doc.md
Follow `workflow__verification-reporting` for result format.
```

## Benefits

- Consistency: no conflicting versions
- Maintainability: single update point
- Clarity: authoritative source is clear
