---
"ast-file-mcp": patch
---

Writing an AsciiDoc document back no longer empties its one-line admonitions.

`WARNING: careful` (or a `NOTE:` paragraph spanning several lines) was read with its text in `source`, and the writer looked only at `lines`, so `ast_write` and `ast_reorder_sections` turned it into an empty `[WARNING]` / `====` block. The body is now written back as `WARNING: careful`.
