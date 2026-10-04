---
"mcp-interactive-instruction": patch
---

`add`, `update`, `link_add` and `link_remove` accept their array arguments as JSON strings.

`instruction` publishes no argument types, so a client has nothing to convert against and sends untyped arguments as strings: Claude Code sends `whenToUse: ["a"]` as `'["a"]'`. `add` requires `whenToUse`, so it could not be called from Claude Code at all. `whenToUse` and `relatedDocs` now take a JSON array in a string; a string that is not a JSON array is still rejected. The conversions for booleans, numbers and arrays now live in `mcp-shared`, for every server whose tools publish no argument types.
