# graph-math-mcp

A small MCP server that does graph theory on task dependencies —
topological sort, critical path, cycle detection — using
[NetworkX](https://networkx.org/).

Distributed as a container image, not on npm.

## Why

The division of labour is the point:

| | |
|---|---|
| **The model** | Reads the text and extracts tasks and dependencies |
| **This server** | Computes the answer, correctly |
| **The model** | Turns the result back into prose or a diagram |

Asked to order twenty interdependent tasks by hand, a language model produces
something plausible. Plausible is not the same as correct, and the failure is
silent — a violated dependency looks exactly like a satisfied one. Once the
graph is extracted, ordering it is arithmetic, and arithmetic should not be
guessed.

## Installation

```bash
docker pull ghcr.io/dbgso/graph-math-mcp:latest
```

Or build locally:

```bash
docker build -t graph-math-mcp packages/graph-math-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "graph-math-mcp": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "ghcr.io/dbgso/graph-math-mcp:latest"]
    }
  }
}
```

The server reads stdin and writes stdout, and touches no files, so it needs no
mounts.

## Input format

Every operation takes the same shape:

```json
{
  "nodes": [
    { "id": "A", "duration": 3 },
    { "id": "B", "duration": 2 },
    { "id": "C", "duration": 4 }
  ],
  "edges": [
    { "from": "A", "to": "B" },
    { "from": "A", "to": "C" }
  ]
}
```

- `nodes[].id` — required, the task identifier
- `nodes[].duration` — optional, used by critical path
- `edges[].from` / `.to` — `from` must finish before `to` starts

## Tools

### `graph_describe`

With no arguments, lists the operations. With `operation`, returns that
operation's detail, including its input and output schema.

### `graph_execute`

| Parameter | Type | Description |
|---|---|---|
| `operation` | string | One of the operations below |
| `data` | object | `nodes` and `edges` |

| Operation | Answers |
|---|---|
| `topological_sort` | In what order can these run without violating a dependency? |
| `critical_path` | Which chain determines the total duration? |
| `detect_cycles` | Is anything waiting on itself? |

`detect_cycles` is worth running first on a graph extracted from prose: a cycle
means the other two operations have no valid answer, and a description written
by humans acquires cycles easily.

## Example

```
graph_execute(operation: "detect_cycles", data: { nodes: [...], edges: [...] })
  → none

graph_execute(operation: "critical_path", data: { nodes: [...], edges: [...] })
  → A → C → E, length 11

graph_execute(operation: "topological_sort", data: { nodes: [...], edges: [...] })
  → A, B, C, D, E
```

## License

MIT
