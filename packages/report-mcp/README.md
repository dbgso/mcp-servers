# report-mcp

An MCP server that turns a structured report into a single HTML page for a
person to read.

The caller fills fields -- conclusion, claims with the raw output that supports
them, what the reader has to decide or do -- and the server lays them out in a
fixed order. A report missing a required field, or carrying a field the
structure does not have, is not written; every problem comes back at once, each
naming the readability criterion its field is for.

## Tools

| Tool | |
|---|---|
| `describe` | The fields, the criteria behind them, and an example |
| `exec` | `exec(op: "report", ...)` writes the page and returns its path |

## Options

| Flag | Default | |
|---|---|---|
| `--output-dir <dir>` | `<os temp dir>/report-mcp` | Where pages are written. Existing files are never overwritten |

## Design

The requirement, spec, design and ADR are in the repository's chain
(`docs/chain`), under the requirement "AI の報告を、事前定義した構造から HTML として配送する".
