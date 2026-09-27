---
description: "How the server is put together: tools, handlers, the reader and the workflow"
whenToUse:
  - finding where a behaviour lives
  - adding an action
  - reviewing a change that crosses layers
relatedDocs:
  - specification__file-structure
  - coding__service-layer
  - design__approval-flow
  - design__frontmatter-metadata
---

# Architecture

This MCP server provides interactive access to markdown documentation.

## Components

### MarkdownReader (src/services/markdown-reader.ts)
Core service for file operations:
- `listDocuments()` - List all .md files with summaries
- `getDocumentContent(id)` - Get full content by ID
- `addDocument(id, content)` - Create new document
- `updateDocument(id, content)` - Update existing document
- `documentExists(id)` - Check if document exists

### Tools (src/tools/)
MCP tool definitions:
- `help` - List or get documents
- `add` - Create new documents
- `update` - Modify existing documents

### Server (src/server.ts)
Creates McpServer instance and registers all tools.

### Entry Point (src/index.ts)
CLI entry point, parses arguments and starts stdio transport.

## Data Flow

```
Client Request → StdioServerTransport → McpServer → Tool → MarkdownReader → FileSystem
```
