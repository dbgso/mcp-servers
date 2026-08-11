---
description: Schema synchronization rules for MCP tools using the handler pattern.
whenToUse:
  - Adding/modifying handler parameters
  - Creating new action handlers
  - Reviewing MCP tool changes
  - Debugging "parameter not passed" issues
relatedDocs:
  - coding-rules__handler-pattern
  - coding-rules__mcp-tool-testing
---

# Schema Synchronization Rules

When using the handler pattern (ActionRegistry), ensure handler schemas and tool inputSchema remain synchronized.

## The Problem

MCP tools with the handler pattern have **two places where schemas are defined**:

1. **Handler-level schema** - Each handler has its own Zod schema
2. **Tool-level inputSchema** - The MCP tool registration schema

These can diverge, causing runtime failures where:
- Handler tests pass (they test handler schema directly)
- Actual MCP calls fail (parameter not passed to handler)

## Required: Schema Consistency Tests

Every MCP tool using ActionRegistry MUST have a schema consistency test that verifies:
1. All handler schema fields are present in inputSchema
2. All handler schema fields are included in rawParams

### Test Structure

```
packages/<mcp-name>/
├── src/
│   ├── tools/<tool-name>/
│   │   ├── input-schema-fields.ts    # List of inputSchema fields
│   │   └── index.ts                   # Tool registration
│   └── __tests__/
│       └── schema-consistency.test.ts # Consistency tests
```

### Example Test

```typescript
import { describe, it, expect } from "vitest";
import { INPUT_SCHEMA_FIELDS } from "../tools/plan/input-schema-fields.js";
import { AddHandler, ConfirmHandler } from "../tools/plan/handlers/index.js";

const inputSchemaFieldSet = new Set(INPUT_SCHEMA_FIELDS);

function getSchemaFields(schema: z.ZodObject<any>): string[] {
  return Object.keys(schema.shape);
}

describe("Schema Consistency", () => {
  const handlers = [new AddHandler(), new ConfirmHandler()];

  for (const handler of handlers) {
    it(`${handler.action}: all schema fields exist in inputSchema`, () => {
      const fields = getSchemaFields(handler.schema);
      const missing = fields.filter(f => !inputSchemaFieldSet.has(f));
      expect(missing).toEqual([]);
    });
  }
});
```

## Checklist When Modifying Handlers

When adding/modifying handler parameters:

1. [ ] Update handler schema (in handler file)
2. [ ] Update inputSchema (in tool registration file)
3. [ ] Update INPUT_SCHEMA_FIELDS (in input-schema-fields.ts)
4. [ ] Update rawParams destructuring (in tool registration file)
5. [ ] Run `pnpm test` to verify consistency

## Why Not Just Test Handlers?

Handler tests call `handler.execute({ rawParams: ... })` directly.
They bypass:
- inputSchema validation
- Parameter destructuring from MCP input
- rawParams object construction

Schema consistency tests catch issues that handler tests cannot.

## Reference Implementation

See `packages/interactive-pdca-mcp/src/__tests__/schema-consistency.test.ts` for a working example.