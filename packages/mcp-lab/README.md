# mcp-lab

Run any MCP server in this repository, from any worktree, and talk to it until you stop it.

Registered once. After that, no restart and no `.mcp.json` edit is needed to reach a server
you are working on — whichever branch, whichever worktree, whichever environment.

## The problem

An MCP server is fixed at the moment the client starts it: the command, the arguments, the
environment and the source on disk. Working on one means the client is holding a process
started from code you have since changed, and the only ways out are bad:

- **restart the client** after every edit, losing the conversation
- **register a second server per worktree**, which is a tracked file edit and still a restart
- **drive it from a script**, which works but costs a file of JSON per experiment

This server is the fixed one, and it is generic, so it never has to change. Everything else is
started through it.

## Actions

```
execute(action: "start", worktree: "/abs/path", package: "interactive-instruction-mcp",
        args: ["{{SCRATCH}}"], env: { IIMCP_LINT_MAX_LINES: "20" })
execute(action: "call",  session: "s1", tool: "instruction", params: { action: "list" })
execute(action: "tools", session: "s1", tool: "instruction")   # one tool's input schema
execute(action: "logs",  session: "s1")                        # the server's stderr
execute(action: "list")
execute(action: "stop",  session: "s1")                        # or { all: true }
```

`describe()` prints the same, with each action's help.

**Every `start` reads the source as it is now.** The server runs from `src/index.ts` through
tsx, not from `dist`: a built bundle goes stale the moment someone edits a source file, and a
harness that quietly answers for last week's code is worse than no harness. Editing and calling
`start` again is the whole reload story. Whether the bundle itself is sound is
`scripts/verify-bundle.mjs`'s question.

**A session lasts until you stop it.** That is what makes stateful servers reachable: a
deliberation gate counting identical attempts, a draft that has to be added before it can be
approved, an update staged before it is applied. None of it survives a harness that starts a
server, makes one call and exits.

**`{{SCRATCH}}`** expands, in the server's arguments and in a call's `params`, to a directory
made for the session and removed with it — so a server that writes files can be pointed
somewhere harmless. `{{WORKTREE}}` expands too. `stop` with `keepScratch: true` leaves the
files behind to look at.

## Comparing two branches

Two sessions, same call:

```
execute(action: "start", worktree: "/repo-a", package: "interactive-instruction-mcp", args: ["{{SCRATCH}}"])
execute(action: "start", worktree: "/repo-b", package: "interactive-instruction-mcp", args: ["{{SCRATCH}}"])
execute(action: "call", session: "s1", tool: "instruction", params: { ... })
execute(action: "call", session: "s2", tool: "instruction", params: { ... })
```

Two sessions on the *same* worktree with different `env` compares behaviour instead of code.

## What it does not do

The child's tool schemas are not re-exposed as this tool's schema: `params` goes through as an
object and the child validates it, so a wrong argument comes back as the child's own error.
`execute(action: "tools", session, tool)` prints the schema when you need it.

## Registering it

```json
"mcp-lab": {
  "command": "npx",
  "args": ["tsx", "./packages/mcp-lab/src/index.ts"]
}
```

This is the one entry that has to exist. Nothing else needs registering, ever.

## Related

- `scripts/mcp-session.mjs` — the same idea as a file of calls, for a session worth keeping:
  committed, replayable, and runnable by CI or by an agent.
- `packages/*/src/__tests__/stdio.test.ts` — for behaviour that must not regress.

Explore here; keep what you find as a flow; promote what must not break into a test.
