---
description: How to install, configure and call this server
whenToUse:
  - setting the server up in a project
  - looking up the shape of a call
  - sharing a documents directory with another tool
relatedDocs:
  - project-concept
  - specification__draft-operations
---

# Usage

How to use mcp-interactive-instruction in your projects.

## Installation

```bash
npx mcp-interactive-instruction /path/to/docs
```

## Configuration

The server takes the documents directory as its first argument.

### Per-project

`.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "mcp-interactive-instruction", "./docs"]
    }
  }
}
```

### Sharing a directory with another tool

`--include` and `--exclude` say which ids this server manages. A document out of
scope is invisible to every action and cannot be written:

```json
"args": ["-y", "mcp-interactive-instruction", "./docs", "--exclude", "chain"]
```

## Tools

Two tools. `instruction_describe()` explains the second one and is the right
first call; everything else is an action on `instruction`.

```
instruction_describe()

instruction(action: "list")                      the promoted corpus
instruction(action: "list", drafts: true)        the drafts
instruction(action: "read", id: "foo")           the prose
instruction(action: "read_meta", id: "foo")      the metadata and its neighbours
instruction(action: "lint")                      quality checks
instruction(action: "graph")                     the relatedDocs graph
```

Writing goes through a draft:

```
instruction(action: "add", id: "new", content: "# New\n\nContent",
            description: "...", whenToUse: ["..."])
instruction(action: "approve", id: "new", notes: "<self-review>")
instruction(action: "approve", id: "new", explanation: "<what you told the user>")
instruction(action: "approve", id: "new", explanation: "<the same words>")
```

The third call is refused on purpose and shows what would change; the identical
fourth one carries it out. Changing a document that is already promoted works
the same way through `update` and then `apply`.

See the README for the full table of actions and gates.
