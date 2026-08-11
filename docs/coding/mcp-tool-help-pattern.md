---
description: Standard pattern for implementing help parameter in MCP tools
whenToUse:
  - Creating new MCP tools
  - Adding help functionality to MCP tools
  - Designing MCP tool interfaces
---

# MCP Tool Help Pattern

All MCP tools must implement a `help` parameter for showing usage information.

## Schema

```typescript
inputSchema: {
  help: z
    .boolean()
    .optional()
    .describe("Show help"),
  // ... other parameters
}
```

## Handler

```typescript
async ({ help, action, ...rest }) => {
  if (help || !action) {
    return { content: [{ type: "text", text: TOOL_HELP }] };
  }
  // ... normal processing
}
```

## Behavior

- `tool(help: true)` → Show help
- `tool()` → Show help (no args)
- `tool(action: "...")` → Execute action

## Rationale

- Consistent with CLI conventions (`--help`)
- Tool descriptions should be short (1 line) and guide users to call `help: true` for details
- Detailed help is only shown when explicitly requested