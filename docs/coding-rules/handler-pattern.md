---
description: Instance-based handler pattern for CLI-style action routing.
whenToUse:
  - Implementing action-based MCP tools
  - Adding subcommands to existing tools
  - Refactoring multiple tools into single tool with actions
---

# Handler Pattern

Instance-based handler pattern for CLI-style action routing.

## Required: Use ActionRegistry

When implementing action-based tools, always use `ActionRegistry` from `mcp-shared`.

```typescript
import { ActionRegistry } from "mcp-shared";
import type { RegistrableActionHandler } from "mcp-shared";

interface MyContext {}

const registry = new ActionRegistry<MyContext>();

registry.registerAll([
  new ReadHandler(),
  new WriteHandler(),
  // ...
]);

// Resolve handler
const handler = registry.getHandler(action);
if (handler) {
  return handler.execute(rawParams, context);
}
```

## Benefits of ActionRegistry

- Duplicate registration check
- `getActions()` to list all actions
- `getHelp(action)` / `getAllHelp()` for help text
- Standardized pattern

## RegistrableActionHandler Interface

```typescript
interface RegistrableActionHandler<TContext> {
  readonly action: string;
  readonly help: string;
  execute(rawParams: unknown, context: TContext): Promise<ToolResponse>;
}
```

## BaseActionHandler (For New Handlers)

When creating new handlers, extend `BaseActionHandler`:

```typescript
import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";

const readSchema = z.object({
  file_path: z.string().describe("File path to read"),
});

type ReadArgs = z.infer<typeof readSchema>;

export class ReadHandler extends BaseActionHandler<ReadArgs, MyContext> {
  readonly action = "read";
  readonly schema = readSchema;

  readonly help = `# my_tool read

Description here.

## Usage
\`\`\`
my_tool(action: "read", file_path: "src/index.ts")
\`\`\`
`;

  protected async doExecute(args: ReadArgs, context: MyContext): Promise<ToolResponse> {
    // Business logic
    return jsonResponse({ ... });
  }
}
```

## Wrapping Existing Handlers

When wrapping existing `BaseToolHandler`-based handlers:

```typescript
function wrapHandler(params: {
  action: string;
  handler: { description: string; execute: (args: unknown) => Promise<ToolResponse> };
}): RegistrableActionHandler<MyContext> {
  const { action, handler } = params;
  return {
    action,
    help: `# my_tool ${action}\n\n${handler.description}`,
    execute(rawParams: unknown, _context: MyContext): Promise<ToolResponse> {
      return handler.execute(rawParams);
    },
  };
}

registry.registerAll([
  wrapHandler({ action: "read", handler: new ExistingReadHandler() }),
  // ...
]);
```

## Key Points

1. **ActionRegistry required**: Use ActionRegistry instead of array + find
2. **rawParams is `unknown`**: Each handler validates with zod
3. **BaseActionHandler**: Extend this for new handlers
4. **wrapHandler**: Adapter pattern for existing handlers