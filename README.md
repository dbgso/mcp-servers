# MCP Servers Monorepo

A collection of Model Context Protocol (MCP) servers.

## Packages

| Package | Description |
|---------|-------------|
| [mcp-git-repo-explorer](./packages/mcp-git-repo-explorer) | Git repository explorer with worktree support |
| [mcp-interactive-instruction](./packages/mcp-interactive-instruction) | Interactive instruction document management |

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
cd packages/mcp-git-repo-explorer
pnpm dev
```

## MCP Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-git-repo-explorer": {
      "command": "npx",
      "args": ["mcp-git-repo-explorer", "/tmp/git-repos"]
    },
    "mcp-interactive-instruction": {
      "command": "npx",
      "args": ["mcp-interactive-instruction", "./docs"]
    }
  }
}
```

## License

MIT
