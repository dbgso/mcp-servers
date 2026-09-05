# wait-mcp

Wait for CI, Slack replies, GitHub issue updates and other external events — with the polling running **inside the MCP server**, not in the agent's loop.

An agent that polls by itself pays for every attempt in context. wait-mcp turns a wait into a single request and a single response, no matter how many times the condition was checked.

## Tools

| Tool | Purpose |
| --- | --- |
| `describe` | List operations, or show one operation's schema |
| `execute` | Run an operation |

Every operation is read-only against the outside world, so the pair can be auto-approved.

## Operations

| Operation | Purpose |
| --- | --- |
| `until` | Create a watch and block until it settles (the usual one) |
| `watch` | Create a watch and return its id immediately |
| `join` | Block on watches created earlier |
| `check` | Evaluate a condition once, without creating a watch |
| `status` | List watches, or inspect one with its recent events |
| `cancel` | Cancel a watch, or every waiting watch |
| `sources` | List watchable sources and their config schemas |

## Sources

| Source | Waits for |
| --- | --- |
| `github_checks` | CI check runs on a commit / PR to finish (`gh`) |
| `github_issue` | A new comment, close, state change or label on an issue or PR (`gh`) |
| `slack` | A reply in a thread or a new message in a channel (Slack Web API) |
| `http` | An endpoint to report the expected status or JSON |
| `file` | A local file to appear, disappear, change or match |

## Usage

```jsonc
// .mcp.json
{
  "mcpServers": {
    "wait-mcp": {
      "command": "npx",
      "args": ["tsx", "./packages/wait-mcp/src/index.ts"]
    }
  }
}
```

```js
// Wait for the PR's CI, stopping as soon as a failure is certain
execute({ operation: "until", params: { source: "github_checks", config: { pr: 42, require: "success" } } })

// Start two waits, then block on whichever finishes first
execute({ operation: "watch", params: { source: "github_issue", config: { number: 34 }, label: "review" } })
execute({ operation: "watch", params: { source: "slack", config: { channel: "C0123", thread_ts: "1712345678.000100" } } })
execute({ operation: "join", params: { ids: ["w_1", "w_2"], mode: "any" } })
```

A call that reaches its block limit returns `status: "waiting"` with a ready-made `join` call in `next`; the watch keeps polling in the background.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WAIT_MCP_MAX_BLOCK_MS` | 240000 | How long one call may block before answering "still waiting" |
| `WAIT_MCP_MAX_WATCHES` | 50 | Maximum number of simultaneously waiting watches |
| `SLACK_BOT_TOKEN` | — | Token for the `slack` source |

GitHub access uses the `gh` CLI's own authentication.

## Documentation

- [仕様 (spec.md)](./docs/spec.md)
- [設計 (design.md)](./docs/design.md)
