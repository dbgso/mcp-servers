# kroki-mcp

MCP server for rendering diagrams through [Kroki](https://kroki.io), paired with
guidance on which diagram type to reach for.

## Why

- **No local toolchain** – Kroki renders server-side, so Mermaid, PlantUML, D2,
  Graphviz, Structurizr and Excalidraw all work without installing Java,
  Graphviz, or anything else
- **Guidance before rendering** – `kroki_describe` returns use cases, syntax
  notes and conventions per diagram type. A model that asks first tends to pick
  a sequence diagram over a flowchart when the subject is an interaction, and
  gets the syntax right on the first attempt rather than the third
- **Renders to a file or into the conversation** – SVG comes back as text, PNG
  and PDF as an image, and passing `output_path` writes to disk instead

## Installation

```bash
npm install -g kroki-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "kroki-mcp": {
      "command": "npx",
      "args": ["-y", "kroki-mcp"]
    }
  }
}
```

### Self-hosted Kroki

`KROKI_URL` points the server elsewhere; it defaults to `https://kroki.io`.
Diagram source is sent to whichever instance is configured, so a self-hosted one
is worth setting up if the diagrams describe something you would rather not send
to a public service.

```json
{
  "mcpServers": {
    "kroki-mcp": {
      "command": "npx",
      "args": ["-y", "kroki-mcp"],
      "env": { "KROKI_URL": "http://localhost:8000" }
    }
  }
}
```

## Tools

### `kroki_describe`

Returns guidance rather than diagrams. Called with no arguments it lists every
diagram tool with the cases each one suits; with `tool` it returns that tool's
conventions; with `tool` and `subDiagram` it narrows to a single diagram type.

| Parameter | Type | Description |
|---|---|---|
| `tool` | string, optional | Diagram tool ID. Omit for the overview |
| `subDiagram` | string, optional | Diagram type within that tool |

### `kroki_render`

Renders diagram source.

| Parameter | Type | Description |
|---|---|---|
| `tool` | string | Diagram tool ID |
| `diagram` | string | Diagram source |
| `format` | `svg` \| `png` \| `pdf` | Defaults to `svg` |
| `output_path` | string, optional | Write to this path instead of returning the diagram |

An unknown `tool` is answered with the list of valid ones, and a rejected
diagram returns Kroki's own error text — usually the line the syntax broke on.

## Supported diagram tools

| Tool | Diagram types covered by the guidelines |
|---|---|
| `mermaid` | flowchart, sequence, class, state, ER, gantt, mindmap, pie, gitGraph |
| `plantuml` | sequence, class, usecase, activity, component, deployment, state |
| `d2` | basic, containers, sequence, class, grid |
| `graphviz` | digraph, graph, cluster |
| `structurizr` | C4 system context and below |
| `excalidraw` | hand-drawn style |

## Example

```
kroki_describe()
  → the tool list, with what each is good for

kroki_describe(tool: "mermaid", subDiagram: "sequence")
  → participant/activation conventions for Mermaid sequence diagrams

kroki_render(
  tool: "mermaid",
  diagram: "sequenceDiagram\n  Client->>Server: request\n  Server-->>Client: response",
  format: "png",
  output_path: "./flow.png"
)
  → Saved to ./flow.png
```

## License

MIT
