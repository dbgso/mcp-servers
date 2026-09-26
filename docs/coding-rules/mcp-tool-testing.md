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

## Testing Without an MCP Restart

Two levels, and the second is the one most tools in this repository need.

### One call: `scripts/mcp-test.sh`

```bash
./scripts/mcp-test.sh <package> <tool> '<json_args>' [-- <server args>]
```

```bash
# A server that needs no arguments of its own
./scripts/mcp-test.sh ast-typescript-mcp ts_ast '{"action":"dead_code","path":"src/handlers"}'

# A server that does: everything after `--` goes to the server
./scripts/mcp-test.sh interactive-instruction-mcp instruction '{"action":"list"}' -- ./docs
```

**Pass the server's own arguments.** `interactive-instruction-mcp` requires its
documents directory; without it the server exits with a usage error before the
call is made. The script used to swallow that and exit 0 with no output, so
"nothing printed" read as "nothing wrong".

### A session: `scripts/mcp-session.mjs`

One call per process cannot express anything with state -- a deliberation gate
that wants the same call twice, a draft that has to be added before it can be
approved, an update staged before it is applied. The session runner keeps one
server up for a whole flow of calls:

```bash
node scripts/mcp-session.mjs <package> <flow.jsonl> [--env K=V] [--keep] [-- <server args>]
```

A flow is JSON Lines, one call per line, with the expectations written beside
the call:

```jsonl
# Blank lines and `#` comments are for the reader.
{"call": "instruction", "label": "add a draft", "args": {"action": "add", "id": "d", "content": "...", "description": "...", "whenToUse": ["..."]}, "expect": ["created successfully"]}
{"call": "instruction", "label": "first attempt is refused", "args": {"action": "approve", "id": "d", "explanation": "..."}, "expect": ["Not Yet -- Tell the User First"]}
{"call": "instruction", "label": "the identical repeat goes through", "args": {"action": "approve", "id": "d", "explanation": "..."}, "expectNot": ["Not Yet -- Tell the User First"]}
```

- `{{TMPDIR}}`, in a server argument or a call argument, expands to a scratch
  directory made for the run and removed after it (`--keep` to keep it)
- `expect` / `expectNot` are substrings, one or a list. An unmet expectation
  exits 1, so a flow is runnable in CI or by an agent as well as by a person
- `{"tools": true}` lists the tools
- The server runs from `src/index.ts`, not `dist`: a built bundle goes stale
  the moment someone edits a source file

Committed flows live in `scripts/flows/<package>/`, and each declares the server it
is written against:

```jsonl
{"server": {"args": ["{{TMPDIR}}"], "env": {"IIMCP_LINT_MAX_LINES": "20"}}}
```

so running one needs no remembered command line. **They run in CI.**
`packages/interactive-instruction-mcp/src/__tests__/flows.test.ts` discovers every
flow in the directory and fails if any expectation is unmet, so adding a flow adds
regression coverage without writing a test -- and a session that found something is
worth committing, because it becomes the thing that keeps it found.

### And a stdio test, for what must not regress

A flow is run when someone runs it. What has to keep working belongs in vitest:
see `packages/interactive-instruction-mcp/src/__tests__/stdio.test.ts`, which
spawns the server and covers the things in-process tests cannot see -- that the
merged input schema survives serialisation, that an environment variable
reaches the server's own process, and that in-memory gate state holds across
two JSON-RPC calls.

## Use AST MCP Tools for File Verification

Use various AST MCP tools to verify the contents of code and document files:

- `mcp__ast-file-mcp__ast_read` - Read Markdown/AsciiDoc files
- `mcp__ast-file-mcp__read_directory` - Overview of all files in a directory
- `mcp__ast-typescript-mcp__ts_structure_read` - TypeScript file structure
- `mcp__ast-typescript-mcp__go_to_definition` - Jump to definition
- `mcp__ast-typescript-mcp__find_references` - Find references
