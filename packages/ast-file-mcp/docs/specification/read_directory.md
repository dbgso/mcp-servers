# read_directory

Find and read all matching files in a directory.

## Supported Formats

- Markdown: `.md`, `.markdown`
- AsciiDoc: `.adoc`, `.asciidoc`, `.asc`

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| directory | `string` | Yes | Directory path to search |
| pattern | `string` | No | File pattern (e.g., `*.md`) |
| cursor | `string` | No | Pagination cursor |
| limit | `number` | No | Results per page |

## Behavior

1. Recursively find files matching pattern
2. If no pattern, find all supported files
3. Extract headings and links from each file
4. Return overview without line numbers

## Output

```json
{
  "files": [
    {
      "filePath": "/docs/README.md",
      "fileType": "markdown",
      "headings": [
        { "depth": 1, "text": "Documentation" },
        { "depth": 2, "text": "Getting Started" }
      ],
      "links": [
        { "url": "./guide.md", "text": "Guide" }
      ]
    }
  ],
  "total": 15,
  "hasMore": true,
  "nextCursor": "eyJpbmRleCI6MTB9",
  "errors": []
}
```

## Examples

```json
// All supported files
{ "directory": "/project/docs" }

// Markdown only
{ "directory": "/project/docs", "pattern": "*.md" }

// AsciiDoc only with pagination
{ "directory": "/project/docs", "pattern": "*.adoc", "limit": 20 }
```
