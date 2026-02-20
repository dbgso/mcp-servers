# MCP Servers Monorepo

A collection of Model Context Protocol (MCP) servers.

## Packages

| Package | Description |
|---------|-------------|
| [git-repo-explorer-mcp](./packages/git-repo-explorer-mcp) | Git repository explorer with worktree support |
| [interactive-instruction-mcp](./packages/interactive-instruction-mcp) | Interactive instruction document management (help, draft, apply) |
| [interactive-pdca-mcp](./packages/interactive-pdca-mcp) | PDCA task planning workflow (plan, approve) |
| [traceable-chain-mcp](./packages/traceable-chain-mcp) | Traceable document chains with enforced dependencies |
| [kroki-mcp](./packages/kroki-mcp) | Diagram rendering via Kroki |
| [mcp-shared](./packages/mcp-shared) | Shared types and utilities for MCP servers |

## Development

### Prerequisites

- Node.js >= 18
- pnpm

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build
```

### Run a package

```bash
cd packages/git-repo-explorer-mcp
pnpm dev
```

## MCP Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "git-repo-explorer-mcp": {
      "command": "npx",
      "args": ["git-repo-explorer-mcp", "/tmp/git-repos"]
    },
    "interactive-instruction-mcp": {
      "command": "npx",
      "args": ["interactive-instruction-mcp", "./docs"]
    },
    "interactive-pdca-mcp": {
      "command": "npx",
      "args": ["interactive-pdca-mcp", "./docs"]
    },
    "traceable-chain-mcp": {
      "command": "npx",
      "args": ["traceable-chain-mcp"]
    },
    "kroki-mcp": {
      "command": "npx",
      "args": ["kroki-mcp"]
    }
  }
}
```

## License

MIT
