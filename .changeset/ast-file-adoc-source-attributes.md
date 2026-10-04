---
"ast-file-mcp": patch
---

AsciiDoc code blocks under `[source,c++]` or `[source,java,linenums]` are reported by `ast_read`'s `code_blocks` query and checked by `lint_document`.

The `[source]` pattern accepted only a language made of word characters followed directly by `]`, so a language like `c++` or any further attribute made the block invisible: it was read neither as a source block nor as a plain listing.
