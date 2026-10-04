---
"kroki-mcp": patch
"mcp-shared": patch
---

`kroki_render` with `format: "pdf"` returns the PDF as an embedded resource instead of as an image.

The PDF came back in an MCP `image` block with `mimeType: application/pdf`. An image block is decoded as an image, so clients could not show it and the Claude API rejects that media type. It is now a `resource` block (`uri: kroki://<tool>/diagram.pdf`, `mimeType: application/pdf`, base64 in `blob`). SVG and PNG output, and saving to `output_path`, are unchanged. `mcp-shared`'s `ToolContent` gains the matching `BlobResourceContent` type.
