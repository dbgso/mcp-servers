---
description: The coverage this package holds itself to, and what is excluded
whenToUse:
  - reading a coverage failure
  - deciding whether a file needs tests
  - changing a threshold
---

# Coverage Requirements

Test coverage requirements for different code types.

## Service Classes (Required: 90%+)

All service classes (`src/services/*`) must have at least 90% test coverage.

## Thin Wrappers (Best Effort)

Code that primarily calls other functions/services (e.g., tool registration, simple delegation) is a best-effort goal for coverage.
