# crawl

Crawl from a starting file, following links recursively.

## Supported Formats

- Markdown: `.md`, `.markdown`
- AsciiDoc: `.adoc`, `.asciidoc`, `.asc`

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | `string` | Yes | Starting file path |
| max_depth | `number` | No | Maximum link depth (default: 10) |
| max_files | `number` | No | Maximum files to crawl |
| cursor | `string` | No | Pagination cursor |
| limit | `number` | No | Results per page |

## Behavior

1. Parse starting file
2. Extract internal links (relative paths, xrefs)
3. Recursively follow links up to max_depth
4. Skip external URLs and already-visited files
5. Return headings and links for each file

## Output

```json
{
  "startFile": "/docs/README.md",
  "files": [
    {
      "filePath": "/docs/README.md",
      "fileType": "markdown",
      "headings": [
        { "depth": 1, "text": "Documentation" }
      ],
      "links": [
        { "url": "./guide.md", "text": "Guide" }
      ]
    },
    {
      "filePath": "/docs/guide.md",
      "fileType": "markdown",
      "headings": [...],
      "links": [...]
    }
  ],
  "total": 5,
  "hasMore": false,
  "errors": []
}
```

## Pagination

```json
// First page
{ "file_path": "/docs/README.md", "limit": 10 }

// Next page
{ "file_path": "/docs/README.md", "cursor": "eyJpbmRleCI6MTB9", "limit": 10 }
```
