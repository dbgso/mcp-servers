# toc_generate

Generate a table of contents from a file.

## Supported Formats

- Markdown: `.md`, `.markdown`
- AsciiDoc: `.adoc`, `.asciidoc`, `.asc`

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | `string` | Yes | Absolute path to file |
| depth | `number` | No | Maximum heading depth to include |

## Output Format

Output format matches input file type:

### Markdown Output

```markdown
- [Title](#title)
  - [Installation](#installation)
    - [Prerequisites](#prerequisites)
  - [Usage](#usage)
```

### AsciiDoc Output

```asciidoc
* <<title,Title>>
** <<installation,Installation>>
*** <<prerequisites,Prerequisites>>
** <<usage,Usage>>
```

## Response

```json
{
  "filePath": "/docs/README.md",
  "toc": "- [Title](#title)\n  - [Installation](#installation)\n  - [Usage](#usage)"
}
```

## Examples

```json
// Full TOC
{ "file_path": "/docs/README.md" }

// Only h1 and h2
{ "file_path": "/docs/README.md", "depth": 2 }
```
