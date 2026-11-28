# ast-typescript-mcp

MCP server for structural search and transformation of TypeScript, built on
[ts-morph](https://ts-morph.com/).

## Why

Grep matches text; this matches structure. The difference shows up whenever the
thing you care about is a *kind* of node rather than a string:

| Task | grep | `ts_ast` |
|---|---|---|
| Find the text `execute` | ✓ | – |
| Find calls to `execute` | ✗ | `query` |
| Find functions named `*Handler` | ✗ | `query` |
| Rename a symbol project-wide | ✗ | `rename` |
| Rewrite every call site's arguments | ✗ | `transform_call_site` |
| Find exports nothing imports | ✗ | `dead_code` |

A rename done with grep hits comments, strings and unrelated identifiers that
happen to match. A rename done here follows the type checker.

## Installation

```bash
npm install -g ast-typescript-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "ast-typescript-mcp": {
      "command": "npx",
      "args": ["-y", "ast-typescript-mcp"]
    }
  }
}
```

## The `ts_ast` tool

One tool, selected by `action`. `ts_ast(help: true)` prints the catalogue, and
`ts_ast(action: "<action>", help: true)` explains a single action — which is
usually faster than reading this file.

### Search and analysis

| Action | Purpose |
|---|---|
| `query` | AST pattern search |
| `find_blocks` | Find code blocks by pattern |
| `references` | Every reference to a symbol |
| `definition` | Go to definition |
| `call_graph` | Function call relationships |
| `dead_code` | Exports nothing imports |
| `type_check` | Run the TypeScript type checker |

### Transformation

| Action | Purpose |
|---|---|
| `transform` | Pattern-based AST transformation |
| `transform_call_site` | Rewrite the arguments at call sites |
| `rename` | Rename a symbol across the project |
| `remove_nodes` | Remove nodes matching a pattern |
| `remove_unused_imports` | Drop imports nothing uses |

### Structure

| Action | Purpose |
|---|---|
| `read` | File structure — functions, classes, and so on |
| `write` | Write or modify structure |
| `dependency_graph` | Module dependencies |
| `monorepo_graph` | Package relationships across a monorepo |

### Batch

`batch` runs several actions atomically, which matters for a refactor that is
only correct once every site has moved.

## Examples

```
ts_ast(action: "query",
       pattern: "CallExpression[expression.name.text=execute]",
       path: "src/")

ts_ast(action: "rename",
       file: "src/foo.ts", line: 10, column: 5,
       newName: "newSymbolName")

ts_ast(action: "transform_call_site",
       file: "src/test.ts",
       callee: "handler.execute",
       transform: "({ rawParams: $1, context: $2 })")

ts_ast(action: "batch", operations: [
  { action: "transform_call_site", file: "a.ts", callee: "foo", transform: "..." },
  { action: "transform_call_site", file: "b.ts", callee: "foo", transform: "..." }
])
```

## License

MIT
