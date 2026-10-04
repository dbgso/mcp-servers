---
"mcp-interactive-instruction": patch
---

`add`, `update`, `link_add` and `link_remove` accept their array arguments as JSON strings.

The same gap as the boolean and number arguments fixed before: `instruction` publishes no argument types, so a client has nothing to serialise against, and Claude Code sends `whenToUse: ["a"]` as the string `'["a"]'`. `add` requires `whenToUse`, so it could not be called from Claude Code at all. `whenToUse` and `relatedDocs` now take a JSON array in a string. A string that is not a JSON array is still rejected.
