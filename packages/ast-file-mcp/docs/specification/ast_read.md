# ast_read

Read file(s) and return AST or query specific elements.

## Supported Formats

- Markdown: `.md`, `.markdown`
- AsciiDoc: `.adoc`, `.asciidoc`, `.asc`

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | `string \| string[]` | Yes | Absolute path(s) to file(s) |
| query | `string` | No | Query type (default: `full`) |
| heading | `string` | No | Get content under specific heading (Markdown only) |
| depth | `number` | No | Max heading depth for `headings` query |

## Query Types

| Type | Description |
|------|-------------|
| `full` | Entire AST |
| `headings` | List of headings with depth, text, line |
| `code_blocks` | List of code blocks with lang, value, line |
| `lists` | List of lists with ordered flag and items |
| `links` | List of links with url, text, line |

## Output

### Single File
```json
{
  "filePath": "/path/to/file.md",
  "fileType": "markdown",
  "query": "headings",
  "data": [
    { "depth": 1, "text": "Title", "line": 1 },
    { "depth": 2, "text": "Section", "line": 5 }
  ]
}
```

### Multiple Files
```json
{
  "results": [
    { "filePath": "/path/a.md", "result": { ... } },
    { "filePath": "/path/b.md", "error": "file not found" }
  ],
  "summary": { "total": 2, "success": 1, "failed": 1 }
}
```

## Examples

```json
// Get all headings
{ "file_path": "/docs/README.md", "query": "headings" }

// Get content under "Installation" section
{ "file_path": "/docs/README.md", "heading": "Installation" }

// Read multiple files
{ "file_path": ["/docs/a.md", "/docs/b.md"], "query": "links" }
```
