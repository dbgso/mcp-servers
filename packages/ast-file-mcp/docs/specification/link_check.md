# link_check

Check links in files for validity.

## Supported Formats

- Markdown: `.md`, `.markdown`
- AsciiDoc: `.adoc`, `.asciidoc`, `.asc`

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | `string \| string[]` | Yes | File path(s) to check |
| check_external | `boolean` | No | Check external URLs (default: false) |
| timeout | `number` | No | HTTP timeout in ms (default: 5000) |

## Link Types Checked

| Type | Check Method |
|------|--------------|
| `#anchor` | Heading exists in same file |
| `./file.md` | File exists |
| `./file.md#anchor` | File exists + heading exists |
| `xref:file.adoc[]` | File exists (AsciiDoc) |
| `https://...` | HTTP HEAD request (if check_external) |

## Output

```json
{
  "filePath": "/docs/README.md",
  "valid": [
    { "url": "./guide.md", "text": "Guide", "line": 10 },
    { "url": "#installation", "text": "Installation", "line": 15 }
  ],
  "broken": [
    { "url": "./missing.md", "text": "Missing", "line": 20, "reason": "file not found" },
    { "url": "#bad-anchor", "text": "Bad", "line": 25, "reason": "heading \"bad-anchor\" not found" }
  ],
  "skipped": [
    { "url": "https://example.com", "text": "Example", "line": 30, "reason": "external link (check_external=false)" }
  ]
}
```

## Examples

```json
// Check internal links only
{ "file_path": "/docs/README.md" }

// Check all links including external
{ "file_path": "/docs/README.md", "check_external": true, "timeout": 10000 }

// Check multiple files
{ "file_path": ["/docs/a.md", "/docs/b.md"] }
```
