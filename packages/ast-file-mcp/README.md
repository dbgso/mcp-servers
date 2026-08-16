# ast-file-mcp

MCP server that reads and writes Markdown and AsciiDoc as structure rather than
as text, and answers questions across a whole documentation tree.

## Why

- **Edit a section, not a line range** – Documents are parsed to an AST, so a
  heading can be replaced or moved without the surrounding text being rewritten
  from memory and quietly losing a list item
- **Read only what you need** – `ast_read` can return just the headings, just
  the code blocks, or the text under one named heading, instead of the whole
  file
- **Questions that span the tree** – Which documents link here, where does this
  link go, what already covers this topic, what would break if this file moved
- **Same tools for both formats** – Markdown (`.md`, `.markdown`) and AsciiDoc
  (`.adoc`, `.asciidoc`, `.asc`) go through one interface

## Installation

```bash
npm install -g ast-file-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "ast-file-mcp": {
      "command": "npx",
      "args": ["-y", "ast-file-mcp"]
    }
  }
}
```

File paths are absolute; the server holds no base directory of its own.

## Tools

### Reading and writing

| Tool | Purpose |
|---|---|
| `ast_read` | Read one or many files. Query `full`, `headings`, `code_blocks`, `lists`, `links` or `sections`, or pass `heading` for the text under one section |
| `ast_write` | Write an AST back to a file |
| `structured_write` | Render structured JSON — tables, sections, lists — into Markdown or AsciiDoc |
| `ast_reorder_sections` | Reorder sections without touching their contents |

### Navigating

| Tool | Purpose |
|---|---|
| `go_to_definition` | Resolve the link at a position to the file and section it points at |
| `find_backlinks` | Every document referencing a file or section — the reverse map, for impact analysis before a move or rename |
| `crawl` | Follow links recursively from a starting file, reporting headings and links per document |
| `read_directory` | Read every matching file in a directory at once |
| `topic_index` | A searchable index of headings across the tree, for finding what already covers a subject |

### Checking

| Tool | Purpose |
|---|---|
| `link_check` | Valid, broken and skipped links; internal targets are resolved on disk |
| `lint_document` | Configurable quality rules, reported by line with severities |
| `structure_analysis` | Metrics — word counts, heading balance, depth — to inform restructuring |
| `diff_structure` | Compare two documents' structure: headings added, removed, modified |
| `toc_generate` | A table of contents in the source document's own format |

## Example

Renaming a document, in the order that avoids leaving dangling links:

```
find_backlinks(target: "docs/setup.md")
  → the six documents linking to it

ast_read(file_path: "docs/setup.md", query: "headings")
  → its outline, without reading the body

… rename, update the six …

link_check(file_path: [...])
  → nothing broken
```

## License

MIT
