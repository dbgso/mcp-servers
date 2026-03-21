# cli-to-mcp

A generic MCP server for executing any CLI command with structured arguments and options.

## Use Cases

Combine with [mcp-firewall](https://www.npmjs.com/package/mcp-firewall) to safely expose CLI tools:

| Use Case | What it does |
|----------|-------------|
| AWS access control | Block `--profile prod`, allow read-only operations |
| GitHub API safety | Block DELETE/PUT, require approval for POST |
| Git protection | Block force push to main |
| Docker safety | Block privileged containers |

## Features

- Execute any CLI command through MCP
- Structured `options` parameter for reliable rule-based filtering
- String or array format for arguments
- Configurable timeout and working directory
- **Designed for use with mcp-firewall** for access control

## Installation

```bash
npm install cli-to-mcp
```

## Usage

### Basic

```bash
cli-to-mcp
```

### With options

```bash
cli-to-mcp --cwd /path/to/dir --timeout 60000
```

### With config file

```bash
cli-to-mcp --config ./config.json
```

config.json:
```json
{
  "cwd": "/path/to/dir",
  "timeout": 60000
}
```

## Tools

### cli_execute

Execute a CLI command.

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | string | Command to execute (e.g., "aws", "docker", "git") |
| `args` | string \| string[] | Command arguments |
| `options` | object | Command options as key-value pairs |

#### Options parameter

The `options` parameter provides structured access to CLI flags:

```typescript
{
  command: "aws",
  args: ["s3", "ls"],
  options: {
    profile: "dev",      // --profile dev
    recursive: true,     // --recursive
    exclude: ["*.log", "*.tmp"]  // --exclude *.log --exclude *.tmp
  }
}
```

Option conversion rules:
- Single character keys: `-k value` (e.g., `{ n: true }` → `-n`)
- Multi-character keys: `--key value` (e.g., `{ profile: "dev" }` → `--profile dev`)
- Boolean `true`: flag only (e.g., `{ force: true }` → `--force`)
- Boolean `false`: omitted
- Array values: repeated flags (e.g., `{ v: ["a", "b"] }` → `-v a -v b`)

### cli_help

Get help for a command.

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | string | Command to get help for |
| `subcommand` | string | Optional subcommand |

### cli_status

Get CLI executor status (current working directory, timeout).

## Integration with mcp-firewall

cli-to-mcp is designed to work with mcp-firewall for rule-based access control.

**⚠️ Important:** cli-to-mcp has no built-in security. Use mcp-firewall to control access.

### Quick Start with Presets

mcp-firewall provides pre-configured rule sets:

```bash
# List available presets
npx mcp-firewall --list-presets

# Use AWS guard preset
npx mcp-firewall \
  --command npx \
  --args cli-to-mcp \
  --preset cli-aws-guard
```

Available presets:
- `cli-aws-guard` - Block production profile, destructive operations
- `cli-git-safe` - Block force push to main
- `cli-docker-safe` - Block privileged containers

### Claude Code Configuration

```json
{
  "mcpServers": {
    "cli-filtered": {
      "command": "npx",
      "args": [
        "mcp-firewall",
        "--command", "npx",
        "--args", "cli-to-mcp",
        "--preset", "cli-aws-guard"
      ]
    }
  }
}
```

Or with custom rules file:

```json
{
  "mcpServers": {
    "cli-filtered": {
      "command": "npx",
      "args": [
        "mcp-firewall",
        "--command", "npx",
        "--args", "cli-to-mcp",
        "--rules-file", "./cli-rules.json"
      ]
    }
  }
}
```

### Rule Examples

#### AWS: Block production profile

```json
{
  "rules": [
    {
      "id": "block-aws-prod",
      "priority": 100,
      "action": "deny",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "aws" },
        { "param": "options.profile", "operator": "matches", "value": "(?i)^(prod|production)$" }
      ],
      "description": "Block AWS commands with production profile"
    },
    {
      "id": "allow-aws-readonly",
      "priority": 50,
      "action": "allow",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "aws" },
        { "param": "args", "operator": "matches", "value": "(?i)(describe|list|get)" }
      ],
      "description": "Allow read-only AWS operations"
    }
  ],
  "defaultAction": "deny"
}
```

#### GitHub CLI: Block destructive API calls

```json
{
  "rules": [
    {
      "id": "block-gh-api-delete",
      "priority": 100,
      "action": "deny",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "gh" },
        { "param": "args[0]", "operator": "equals", "value": "api" },
        { "param": "options.method", "operator": "matches", "value": "(?i)^(DELETE|PUT)$" }
      ],
      "description": "Block destructive GitHub API calls"
    },
    {
      "id": "ask-gh-api-post",
      "priority": 90,
      "action": "ask",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "gh" },
        { "param": "args[0]", "operator": "equals", "value": "api" },
        { "param": "options.method", "operator": "equals", "value": "POST" }
      ],
      "description": "Require approval for POST requests"
    },
    {
      "id": "allow-gh-api-get",
      "priority": 50,
      "action": "allow",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "gh" },
        { "param": "args[0]", "operator": "equals", "value": "api" }
      ],
      "description": "Allow GET requests (default method)"
    },
    {
      "id": "allow-gh-readonly",
      "priority": 40,
      "action": "allow",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "gh" },
        { "param": "args[0]", "operator": "matches", "value": "^(pr|issue|repo|run)$" },
        { "param": "args[1]", "operator": "matches", "value": "^(list|view|status)$" }
      ],
      "description": "Allow gh pr list, gh issue view, etc."
    }
  ],
  "defaultAction": "deny"
}
```

#### Block force push to main

```json
{
  "rules": [
    {
      "id": "block-force-push-main",
      "priority": 100,
      "action": "deny",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "git" },
        { "param": "args[0]", "operator": "equals", "value": "push" },
        { "param": "args", "operator": "contains", "value": "--force" },
        { "param": "args[2]", "operator": "equals", "value": "main" }
      ],
      "description": "Block force push to main branch"
    }
  ]
}
```

#### Block dangerous Docker options

```json
{
  "rules": [
    {
      "id": "block-docker-privileged",
      "priority": 100,
      "action": "deny",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "docker" },
        { "param": "options.privileged", "operator": "equals", "value": true }
      ],
      "description": "Block privileged Docker containers"
    },
    {
      "id": "block-docker-host-mount",
      "priority": 90,
      "action": "deny",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "docker" },
        { "param": "options.volume[0]", "operator": "contains", "value": "/etc" }
      ],
      "description": "Block mounting /etc into containers"
    }
  ]
}
```

### Supported Condition Patterns

| Pattern | Syntax | Example |
|---------|--------|---------|
| Option value | `options.key` | `options.profile = "prod"` |
| Positional arg | `args[N]` | `args[0] = "push"` |
| Nested array | `options.key[N]` | `options.volume[0]` |
| Substring match | `contains` | `args contains "--force"` |
| Regex match | `matches` | `args matches "^--profile"` |

## License

MIT
