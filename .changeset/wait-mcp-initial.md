---
"wait-mcp": minor
"mcp-shared": patch
---

Add wait-mcp: an MCP server that waits for CI, Slack replies, GitHub issue updates, HTTP endpoints and local files by polling inside the server, so a wait costs a single request and response regardless of how many polls it took.

`createDescribeExecuteHandlers` now accepts an empty prefix to expose the bare `describe` / `execute` tool names.
