# Handler Pattern

Instance-based handler pattern for CLI-style action routing.

## Pattern Overview

```typescript
// types/index.ts
export type PlanRawParams = {
  id?: string;
  // ... all possible params
};

export interface PlanActionHandler {
  readonly action: string;
  readonly help: string;
  execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult>;
}
```

## Handler Implementation

```typescript
import { z } from "zod";
import type { PlanActionContext, ToolResult, PlanRawParams } from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID"),
  // action-specific params with .describe()
});

export class ListHandler {
  readonly action = "list";

  readonly help = `# plan list

Description here.

## Usage
\`\`\`
plan(action: "list")
\`\`\`

## Parameters
- **id** (required): Task ID
`;

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }
    
    const { id } = parseResult.data;
    const { planReader } = params.context;
    
    // Business logic here
    
    return {
      content: [{ type: "text" as const, text: "Success" }],
    };
  }
}
```

## Router (index.ts)

```typescript
import type { PlanRawParams, PlanActionHandler } from "../../types/index.js";

const handlers: PlanActionHandler[] = [
  new ListHandler(),
  new ReadHandler(),
  // ...
];

function resolveHandler(action: string): PlanActionHandler | undefined {
  return handlers.find((h) => h.action === action);
}

// In tool registration
async (toolParams) => {
  const { action, ...rest } = toolParams;
  
  if (!action) {
    return showHelp();
  }
  
  const handler = resolveHandler(action);
  if (!handler) {
    return { error: `Unknown action: ${action}` };
  }
  
  const rawParams: PlanRawParams = { ...rest };
  const context: PlanActionContext = { /* ... */ };
  
  return handler.execute({ rawParams, context });
}
```

## Key Points

1. **Instance-based**: Handlers are instantiated once in the handlers array
2. **Self-describing**: Each handler has `action` and `help` properties
3. **Single params object**: `execute({ rawParams, context })` - ESLint rule
4. **Zod validation inside execute**: Each handler validates its own params
5. **Resolver pattern**: No switch statement, use `handlers.find(h => h.action === action)`
6. **Type-safe rawParams**: Use `PlanRawParams` type instead of `Record<string, unknown>`
