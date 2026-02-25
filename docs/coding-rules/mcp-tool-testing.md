---
description: When creating or modifying MCP tools, follow this process.
whenToUse:
  - Creating new MCP tools
  - Fixing MCP tool bugs
  - Testing MCP tool changes
  - Debugging MCP tool issues
---

# MCP Tool Testing Requirements

When creating or modifying MCP tools, follow this process.

## Absolutely Prohibited

**Never manually fix code when an MCP tool under development is not working properly.**

Working on code modifications using MCP tools also serves as testing for the tool itself. If the tool is not functioning correctly, fix the tool's bug first, then use it again.

## Required Workflow

When an issue occurs with an MCP tool, always execute the following steps in order:

1. **Write/fix tests**
   - Write test code for the case causing the issue
   - Add tests if existing tests are insufficient

2. **Fix until tests pass 100%**
   - Run unit tests with `pnpm --filter <package-name> test`
   - Confirm that all tests pass, including integration tests
   - Repeat this step until the bug is completely resolved

3. **Build verification**
   - Build with `pnpm --filter <package-name> build`
   - Confirm there are no TypeScript errors

4. **Request MCP restart**
   - Ask the user to restart MCP
   - The fix won't take effect without a restart

5. **Test using the actual MCP**
   - After restart, test the MCP tool with actual use cases
   - Confirm it works as expected

## How to Write Tests

### Directory Structure

```
packages/<mcp-name>/
├── src/
│   ├── __tests__/
│   │   ├── fixtures/       # Test files
│   │   │   ├── sample.md
│   │   │   └── sample.adoc
│   │   └── integration.test.ts
│   └── handlers/
```

### Test Example

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { SomeHandler } from "../handlers/some.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

describe("Integration Tests", () => {
  let handler: SomeHandler;

  beforeAll(() => {
    handler = new SomeHandler();
  });

  it("should read file and return expected structure", async () => {
    const filePath = join(FIXTURES_DIR, "sample.md");
    const result = await handler.read(filePath);

    expect(result.filePath).toBe(filePath);
    expect(result.data).toBeDefined();
  });
});
```

## Use AST MCP Tools for File Verification

Use various AST MCP tools to verify the contents of code and document files:

- `mcp__ast-file-mcp__ast_read` - Read Markdown/AsciiDoc files
- `mcp__ast-file-mcp__read_directory` - Overview of all files in a directory
- `mcp__ast-typescript-mcp__ts_structure_read` - TypeScript file structure
- `mcp__ast-typescript-mcp__go_to_definition` - Jump to definition
- `mcp__ast-typescript-mcp__find_references` - Find references
