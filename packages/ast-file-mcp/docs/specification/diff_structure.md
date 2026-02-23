# diff_structure

Compare structure of two files.

## Supported Formats

- Markdown: `.md`, `.markdown`
- AsciiDoc: `.adoc`, `.asciidoc`, `.asc`

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path_a | `string` | Yes | First file path |
| file_path_b | `string` | Yes | Second file path |
| level | `string` | No | `summary` (default) or `detailed` |

## Comparison Method

Compares headings between two files:
- Key format: `{depth}:{text}` (e.g., `2:Installation`)
- Added: in B but not in A
- Removed: in A but not in B
- Modified: same key but different line numbers (detailed only)

## Output

```json
{
  "filePathA": "/docs/v1.md",
  "filePathB": "/docs/v2.md",
  "fileType": "markdown",
  "added": [
    { "key": "2:Quick Start", "depth": 2, "text": "Quick Start" }
  ],
  "removed": [
    { "key": "2:Getting Started", "depth": 2, "text": "Getting Started" }
  ],
  "modified": [],
  "summary": "Added: 1, Removed: 1, Modified: 0"
}
```

### Detailed Level

Includes line numbers for modified detection:

```json
{
  "modified": [
    {
      "key": "2:Installation",
      "a": { "depth": 2, "text": "Installation", "line": 10 },
      "b": { "depth": 2, "text": "Installation", "line": 25 }
    }
  ]
}
```

## Examples

```json
// Summary comparison
{
  "file_path_a": "/docs/old.md",
  "file_path_b": "/docs/new.md"
}

// Detailed with line numbers
{
  "file_path_a": "/docs/old.md",
  "file_path_b": "/docs/new.md",
  "level": "detailed"
}
```
