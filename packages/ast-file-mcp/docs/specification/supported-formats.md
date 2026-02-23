# Supported File Formats

## Markdown

| Extension | MIME Type |
|-----------|-----------|
| `.md` | text/markdown |
| `.markdown` | text/markdown |

### Parser
- **Library**: remark (unified ecosystem)
- **AST Format**: [mdast](https://github.com/syntax-tree/mdast)

### Capabilities
| Feature | Support |
|---------|---------|
| Read (AST) | ✅ |
| Write (AST) | ✅ |
| Query (headings) | ✅ |
| Query (code_blocks) | ✅ |
| Query (lists) | ✅ |
| Query (links) | ✅ |
| Go to Definition | ✅ |
| Crawl | ✅ |
| Read Directory | ✅ |
| TOC Generate | ✅ |
| Link Check | ✅ |
| Diff Structure | ✅ |

## AsciiDoc

| Extension | MIME Type |
|-----------|-----------|
| `.adoc` | text/asciidoc |
| `.asciidoc` | text/asciidoc |
| `.asc` | text/asciidoc |

### Parser
- **Library**: asciidoctor.js
- **AST Format**: Custom `AsciidocDocument` structure

### Capabilities
| Feature | Support |
|---------|---------|
| Read (AST) | ✅ |
| Write (AST) | ❌ |
| Query (headings) | ✅ |
| Query (code_blocks) | ❌ |
| Query (lists) | ❌ |
| Query (links) | ✅ |
| Go to Definition | ❌ |
| Crawl | ✅ |
| Read Directory | ✅ |
| TOC Generate | ✅ |
| Link Check | ✅ |
| Diff Structure | ✅ |

## Link Types

### Markdown
| Type | Example | Supported |
|------|---------|-----------|
| Internal anchor | `#section` | ✅ |
| Relative file | `./other.md` | ✅ |
| File with anchor | `./other.md#section` | ✅ |
| External URL | `https://example.com` | ✅ |
| Reference link | `[text][ref]` | ✅ |

### AsciiDoc
| Type | Example | Supported |
|------|---------|-----------|
| Internal anchor | `<<section>>` | ✅ |
| Cross-reference | `xref:other.adoc[]` | ✅ |
| Xref with anchor | `xref:other.adoc#section[]` | ✅ |
| External URL | `https://example.com[text]` | ✅ |
| Include directive | `include::partial.adoc[]` | ✅ (as link) |
