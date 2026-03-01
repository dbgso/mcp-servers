# ast-file-mcp Overview

MCP server for reading and analyzing documentation files via AST.

## Why This Tool Exists

**Problem**: AI agents reading documentation with raw text tools face issues:
- Large files consume too many tokens
- No structure awareness (can't jump to specific section)
- Can't follow links between documents
- Can't validate documentation quality

**Solution**: AST-based approach provides:
- **Selective reading**: Query only headings, links, or specific sections
- **Structure awareness**: Navigate by heading, follow links
- **Documentation graph**: Crawl from entry point to build doc map
- **Quality checks**: Validate links, compare versions

## Purpose

- Parse Markdown/AsciiDoc files into structured AST
- Query specific elements (headings, links, code blocks)
- Navigate documentation (go to definition, crawl links)
- Validate documentation quality (link check, structure diff)

## Use Cases

### Documentation Analysis
- Extract all headings from a file
- List all links in a document
- Find all code blocks with specific language

### Documentation Navigation
- Jump to where a link points (go_to_definition)
- Build documentation map from entry point (crawl)
- Get overview of all docs in a directory (read_directory)

### Documentation Quality
- Check for broken links (link_check)
- Compare document structure between versions (diff_structure)
- Generate table of contents (toc_generate)

### AST Manipulation
- Read file as AST for programmatic analysis
- Write modified AST back to file (Markdown only)

## Tools Summary

| Tool | Description |
|------|-------------|
| `ast_read` | Read file(s), return AST or query elements |
| `ast_write` | Write AST to file (Markdown only) |
| `go_to_definition` | Find link target location |
| `crawl` | Follow links recursively from entry point |
| `read_directory` | Read all matching files in directory |
| `toc_generate` | Generate table of contents |
| `link_check` | Validate internal/external links |
| `diff_structure` | Compare heading structure of two files |

## Supported Formats

- Markdown (`.md`, `.markdown`)
- AsciiDoc (`.adoc`, `.asciidoc`, `.asc`)

See [supported-formats.md](supported-formats.md) for details.
