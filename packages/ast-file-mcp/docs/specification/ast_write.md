# ast_write

Write an AST back to a file.

## Supported Formats

- Markdown only (`.md`, `.markdown`)

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | `string` | Yes | Absolute path to file |
| ast | `object` | Yes | mdast Root node |

## AST Format

Uses [mdast](https://github.com/syntax-tree/mdast) format:

```json
{
  "type": "root",
  "children": [
    {
      "type": "heading",
      "depth": 1,
      "children": [{ "type": "text", "value": "Title" }]
    },
    {
      "type": "paragraph",
      "children": [{ "type": "text", "value": "Content" }]
    }
  ]
}
```

## Output

```json
{ "success": true, "filePath": "/path/to/file.md" }
```

## Example

```json
{
  "file_path": "/docs/output.md",
  "ast": {
    "type": "root",
    "children": [
      {
        "type": "heading",
        "depth": 1,
        "children": [{ "type": "text", "value": "Generated Doc" }]
      }
    ]
  }
}
```
