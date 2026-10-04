---
"ast-file-mcp": patch
---

`ast_reorder_sections` no longer moves an AsciiDoc section of another level to the top of the document.

A top-level section whose level differs from the one being reordered (for example a `= Appendix` after the `==` sections) was treated as preamble, and the preamble is written first, so even a reorder that kept the order moved it above every section. It now stays with the section before it, as any other content there does and as Markdown already behaved.
