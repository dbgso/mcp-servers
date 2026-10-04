---
"ast-file-mcp": patch
---

An AsciiDoc `query` with a `heading` returns that section, as it does for Markdown.

It returned the whole document, labelled as the section, and without the comments and includes a normal read keeps. It now returns a document holding only the section with that title (searched at any depth), or no blocks when there is none.
