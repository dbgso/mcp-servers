# mcp-firewall

A rule-based firewall for MCP servers. Wrap any MCP server and control tool access with allow/deny/ask rules.

## Features

- Wrap any MCP server
- **3 action types**: allow / deny / ask (requires approval)
- Glob pattern matching for tool names (`browser_*`)
- Parameter condition filtering
- **Array index access**: `args[0]`, `options.volume[1]`
- **Nested object access**: `options.profile`, `options.method`
- Priority-based rule evaluation
- File persistence for rules
- Runtime rule management (add/update/delete)
- **Ask workflow**: Require user approval before execution (desktop notification)
- **Dry-run mode**: Log only without blocking (for rule debugging)
- **Audit logging**: JSON Lines format audit log for all tool calls
- **Signal propagation**: Proper Ctrl+C handling for parent and child processes

## Installation

```bash
npm install mcp-firewall
```

## Usage

### CLI arguments

```bash
mcp-firewall \
  --command npx \
  --args @anthropic/mcp-playwright \
  --rules-file ./rules.json
```

### Using presets

```bash
# List available presets
mcp-firewall --list-presets

# Use a preset
mcp-firewall \
  --command npx \
  --args @anthropic/mcp-playwright \
  --preset playwright-safe
```

### Config file

```bash
mcp-firewall --config ./proxy-config.json
```

proxy-config.json:
```json
{
  "target": {
    "command": "npx",
    "args": ["@anthropic/mcp-playwright"]
  },
  "rulesFile": "./rules.json"
}
```

## Rule Configuration

### Rule File (rules.json)

```json
{
  "rules": [
    {
      "id": "block-delete-buttons",
      "priority": 100,
      "action": "deny",
      "toolPattern": "browser_click",
      "conditions": [
        { "param": "ref", "operator": "contains", "value": "delete" }
      ],
      "description": "Block clicking delete buttons"
    },
    {
      "id": "allow-browser-tools",
      "priority": 50,
      "action": "allow",
      "toolPattern": "browser_*",
      "description": "Allow other browser operations"
    }
  ],
  "defaultAction": "deny"
}
```

### Action Types

| Action | Description |
|--------|-------------|
| `allow` | Allow the tool call (execute as-is) |
| `deny` | Deny the tool call (block) |
| `ask` | Require user approval (execute after approval) |

### Rule Evaluation Order

1. Evaluate rules in priority order (highest first)
2. Check if `toolPattern` matches
3. Check if all `conditions` are satisfied (AND logic)
4. Apply the `action` of the first matching rule
5. If no rule matches, apply `defaultAction`

### toolPattern

Glob patterns for matching tool names:

| Pattern | Matches |
|---------|---------|
| `browser_click` | `browser_click` only |
| `browser_*` | `browser_click`, `browser_navigate`, ... |
| `*` | All tools |

### Conditions

Parameter conditions (multiple conditions use AND logic):

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match | `{ "param": "ref", "operator": "equals", "value": "btn-1" }` |
| `contains` | Substring match | `{ "param": "ref", "operator": "contains", "value": "delete" }` |
| `matches` | Regex match | `{ "param": "url", "operator": "matches", "value": "^https://evil" }` |
| `exists` | Existence check | `{ "param": "force", "operator": "exists" }` |

### Parameter Access Patterns

#### Dot notation for nested objects
```json
{ "param": "options.profile", "operator": "equals", "value": "prod" }
```

#### Array index access
```json
{ "param": "args[0]", "operator": "equals", "value": "push" }
{ "param": "args[2]", "operator": "equals", "value": "main" }
```

#### Nested array access
```json
{ "param": "options.volume[0]", "operator": "contains", "value": "/etc" }
```

#### Array contains (checks any element)
```json
{ "param": "args", "operator": "contains", "value": "--force" }
```
This matches if ANY element in the `args` array contains "--force".

## Provided Tools

Proxy management tools:

| Tool | Description |
|------|-------------|
| `proxy_execute` | Execute a tool through the proxy |
| `proxy_rule_list` | List all rules |
| `proxy_rule_add` | Add a rule |
| `proxy_rule_remove` | Remove a rule |
| `proxy_rule_update` | Update a rule |
| `proxy_rule_test` | Test rule evaluation |
| `proxy_status` | Check proxy status |
| `proxy_set_default` | Set default action |
| `proxy_pending` | List pending approval requests |
| `proxy_approve` | Approve a pending request |
| `proxy_reject` | Reject a pending request |

## Examples

### Wrap Playwright MCP

```json
{
  "rules": [
    {
      "id": "block-dangerous-buttons",
      "priority": 100,
      "action": "deny",
      "toolPattern": "browser_click",
      "conditions": [
        { "param": "ref", "operator": "matches", "value": "delete|remove|destroy" }
      ],
      "description": "Block clicking dangerous buttons"
    },
    {
      "id": "block-external-navigation",
      "priority": 90,
      "action": "deny",
      "toolPattern": "browser_navigate",
      "conditions": [
        { "param": "url", "operator": "matches", "value": "^https?://(?!localhost)" }
      ],
      "description": "Block navigation to external sites"
    },
    {
      "id": "block-js-eval",
      "priority": 80,
      "action": "deny",
      "toolPattern": "browser_evaluate",
      "description": "Block JavaScript execution"
    },
    {
      "id": "allow-all-browser",
      "priority": 10,
      "action": "allow",
      "toolPattern": "browser_*",
      "description": "Allow other browser operations"
    }
  ],
  "defaultAction": "deny"
}
```

### Wrap cli-to-mcp for AWS Access Control

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
        { "param": "options.profile", "operator": "equals", "value": "prod" }
      ],
      "description": "Block AWS commands with production profile"
    },
    {
      "id": "allow-aws-dev",
      "priority": 50,
      "action": "allow",
      "toolPattern": "cli_execute",
      "conditions": [
        { "param": "command", "operator": "equals", "value": "aws" }
      ],
      "description": "Allow AWS commands with other profiles"
    }
  ],
  "defaultAction": "deny"
}
```

### Block Git Force Push to Main

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

### Add Rules at Runtime

```
proxy_rule_add({
  priority: 200,
  action: "deny",
  toolPattern: "browser_click",
  conditions: [{ param: "ref", operator: "contains", value: "payment" }],
  description: "Temporarily block payment buttons"
})
```

## Ask Workflow (Approval Flow)

Require user approval before executing dangerous operations:

```json
{
  "rules": [
    {
      "id": "ask-before-delete",
      "priority": 100,
      "action": "ask",
      "toolPattern": "browser_click",
      "conditions": [
        { "param": "ref", "operator": "contains", "value": "delete" }
      ],
      "description": "Confirm before clicking delete buttons"
    }
  ]
}
```

### Ask Workflow Steps

1. Tool call matches an `ask` rule
2. Desktop notification displays approval token
3. Response returns "approval required" with Request ID
4. User calls `proxy_approve` or `proxy_reject`
5. If approved, original tool is executed

### Approval Commands

```
// List pending approvals
proxy_pending()

// Approve (token is shown in desktop notification)
proxy_approve({ requestId: "01ABC...", approvalToken: "1234" })

// Reject
proxy_reject({ requestId: "01ABC..." })
```

## Dry-run Mode

Test rules without actually blocking - log only:

```bash
mcp-firewall --config ./proxy-config.json --dry-run
```

Or in config file:

```json
{
  "target": { "command": "npx", "args": ["@anthropic/mcp-playwright"] },
  "rulesFile": "./rules.json",
  "dryRun": true
}
```

In dry-run mode:
- Blocked calls are logged (stderr)
- Tools are executed anyway
- Results include `[DRY-RUN NOTE]`

## Audit Log

Record all tool call decisions to a JSON Lines file:

```bash
mcp-firewall --config ./proxy-config.json --audit-log ./audit.jsonl
```

Or in config file:

```json
{
  "target": { "command": "npx", "args": ["@anthropic/mcp-playwright"] },
  "rulesFile": "./rules.json",
  "auditLog": "./audit.jsonl"
}
```

### Log Entry Format

Each line is a JSON object:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "toolName": "browser_click",
  "args": { "ref": "btn-1" },
  "action": "allow",
  "ruleId": "allow-browser-tools",
  "reason": "Matched rule: allow-browser-tools",
  "result": "executed"
}
```

### Log Fields

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp |
| `toolName` | Tool that was called |
| `args` | Arguments passed to the tool |
| `action` | Rule action: `allow`, `deny`, `ask`, or `error` |
| `ruleId` | ID of the matched rule (if any) |
| `reason` | Human-readable reason for the decision |
| `result` | Outcome: `executed`, `blocked`, `pending`, or `error` |
| `error` | Error message (only for `error` action) |

## Claude Code Configuration

```json
{
  "mcpServers": {
    "playwright-filtered": {
      "command": "npx",
      "args": [
        "mcp-firewall",
        "--command", "npx",
        "--args", "@anthropic/mcp-playwright",
        "--rules-file", "./playwright-rules.json"
      ]
    }
  }
}
```

## License

MIT
