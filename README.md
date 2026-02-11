# MCP Servers Monorepo

A collection of Model Context Protocol (MCP) servers.

## Packages

| Package | Description |
|---------|-------------|
| [git-repo-explorer-mcp](./packages/git-repo-explorer-mcp) | Git repository explorer with worktree support |
| [interactive-instruction-mcp](./packages/interactive-instruction-mcp) | Interactive instruction document management |
| [traceable-chain-mcp](./packages/traceable-chain-mcp) | Traceable document chains with enforced dependencies |

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
    "traceable-chain-mcp": {
      "command": "npx",
      "args": ["traceable-chain-mcp"]
    }
  }
}
```

## License

MIT
