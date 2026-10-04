---
"ast-file-mcp": patch
---

`structure_analysis` on a directory lists its files sorted by path, as `read_directory` does, instead of all Markdown files first and then all AsciiDoc files. The three tools that read a directory now share one reader.
