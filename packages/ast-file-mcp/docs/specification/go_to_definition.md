# go_to_definition

Find where a link at the given position points to.

## Supported Formats

- Markdown only (`.md`, `.markdown`)

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | `string` | Yes | Absolute path to file |
| line | `number` | Yes | Line number (1-based) |
| column | `number` | Yes | Column number (1-based) |

## Link Resolution

| Link Type | Resolution |
|-----------|------------|
| `#anchor` | Heading in same file |
| `./other.md` | Relative file path |
| `./other.md#section` | File + heading anchor |
| `https://...` | External URL (returned as-is) |

## Output

```json
{
  "sourceFilePath": "/docs/README.md",
  "sourceLine": 10,
  "sourceColumn": 5,
  "linkUrl": "./guide.md#installation",
  "targetFilePath": "/docs/guide.md",
  "targetLine": 15,
  "targetHeading": "Installation"
}
```

### When No Link Found

```json
{
  "sourceFilePath": "/docs/README.md",
  "sourceLine": 10,
  "sourceColumn": 5,
  "linkUrl": null,
  "message": "No link found at position"
}
```

## Example

```json
{
  "file_path": "/docs/README.md",
  "line": 25,
  "column": 15
}
```
