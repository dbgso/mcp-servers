---
description: The checks to run after any change, in order
whenToUse:
  - finishing a change
  - before opening a PR
  - after a rebase
relatedDocs:
  - testing__coverage
  - testing__patterns
---

# Verification Steps

Always run these checks after code changes:

1. `pnpm build` - typecheck
2. `pnpm test` - run tests

Do not commit until all checks pass.
