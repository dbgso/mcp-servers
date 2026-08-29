# interactive-pdca-mcp

MCP server for running work as explicit Plan-Do-Check-Act cycles, with the
approval step reserved for a human.

## Why

- **The plan is written down before the work starts** – `add` requires
  completion criteria, prerequisites, deliverables and the reason for each
  dependency. A task that cannot be described that way is usually one that has
  not been thought through
- **Dependencies are declared, not implied** – `graph` shows the ordering that
  results, so "this was supposed to come first" surfaces before the work does
- **Completion is not self-certified** – An agent submits for review; only a
  human calls `approve`, and task approval takes a token from a desktop
  notification, so it cannot be satisfied by an agent deciding it is finished
- **Feedback is interpreted back before being acted on** – A human leaves
  feedback, the agent states what it understood, the human confirms. The
  misreading is caught before the rework

## Installation

```bash
npm install -g interactive-pdca-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "interactive-pdca-mcp": {
      "command": "npx",
      "args": ["-y", "interactive-pdca-mcp"]
    }
  }
}
```

Tasks are stored under the OS temporary directory
(`mcp-interactive-instruction-plan`), scoped to the current working session.

## Tools

### `plan`

Called with no arguments it prints its own help, which is more current than this
table.

| Action | Purpose |
|---|---|
| `list` | All tasks |
| `read` | One task in detail |
| `read_output` | A task's recorded output |
| `add` | Create a task |
| `update` | Modify a task |
| `delete` | Delete a task |
| `clear` | Remove all tasks |
| `graph` | The dependency graph |
| `start` | Begin a task, which returns the guided workflow for it |
| `submit_plan` / `submit_do` / `submit_check` / `submit_act` | Submit each PDCA phase for review |
| `feedback` | Record human feedback on a task |
| `interpret` | State back what the feedback was understood to mean |
| `confirm` | Confirm a step |
| `request_changes` | Send work back |
| `block` | Mark a task blocked |

Creating a task requires `id`, `title`, `content`, `parent`, `dependencies`,
`dependency_reason` (when there are dependencies), `prerequisites`,
`completion_criteria`, `deliverables`, `is_parallelizable` and `references`.

### `approve`

**For humans. An agent should never call this.**

| Target | Purpose |
|---|---|
| `task` | Approve a task awaiting review |
| `feedback` | Confirm the agent read the feedback correctly |
| `deletion` | Approve a cascading delete |
| `skip` | Skip a task, with a reason |
| `setup_templates` / `skip_templates` | Set up or decline self-review templates |

Approving a task or a skip takes two calls: the first sends a desktop
notification containing a token, and the second passes that token back.

## Example

A bug fix, decomposed so that each phase can be reviewed on its own:

```
plan(action: "add", id: "fix-bug__research",
     title: "Investigate the bug", content: "Find root cause",
     dependencies: [], ...)

plan(action: "add", id: "fix-bug__implement",
     title: "Apply the fix", content: "Implement solution",
     dependencies: ["fix-bug__research"],
     dependency_reason: "Need to know cause before fixing", ...)

plan(action: "add", id: "fix-bug__test",
     title: "Verify the fix", content: "Test the solution",
     dependencies: ["fix-bug__implement"],
     dependency_reason: "Need fix before testing", ...)

plan(action: "start", id: "fix-bug__research", prompt: "<instructions>")
```

Decomposition earns its cost when the work involves investigation before
implementation, several distinct deliverables, or verification worth its own
cycle.

## License

MIT
