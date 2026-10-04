---
"mcp-shared": patch
"ast-typescript-mcp": patch
---

`ts_ast` accepts its object arguments sent as JSON strings: a custom `query` (for `query` and `transform`), `additions`, and `structure`. A query written by hand rather than chosen from a preset failed from Claude Code. mcp-shared adds `looseObject` for this.
