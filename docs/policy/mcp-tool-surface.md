---
description: Every server has two tools, describe and exec. exec takes op; no schema carries argument information, and describe carries all of it.
whenToUse:
  - Registering a tool on an MCP server
  - Deciding what a tool's inputSchema should contain
  - Adding or renaming a describe tool
  - Naming a tool or adding an operation to one
  - Reviewing a server whose schema lists its arguments
---

# The tool surface

**A tool publishes no information about its arguments. `describe` publishes all of
it.** The schema accepts anything; the handler decides what is valid; `describe`
says what the handler wants.

## The rules

1. **A tool's `inputSchema` names no argument.** It is `z.object({}).passthrough()`.
2. **Every server registers two tools, `describe` and `exec`.** A server without
   `describe` is incomplete, not minimal.
3. **The tool says what kind of call it is; `op` says what the call does.** `exec`
   takes an `op` argument naming the operation, and `describe` lists every `op`.
   A tool named after the domain (`instruction`, `chain_query`) repeats the
   server's name, and one named after the operation (`kroki_render`) repeats the
   `op`. Either way the name says something twice.
4. **No prefix.** The server name is already the namespace: a caller reaches the
   tools as `mcp__<server>__describe` and `mcp__<server>__exec`, so a prefix
   inside the tool name says the same thing twice.
5. **An `op` a person must approve goes in `approve`, not `exec`.** Claude Code
   approves per tool, not per argument (`coding-rules__mcp-tool-approval`), so an
   `op` inside `exec` is approved whenever `exec` is. A server whose ops all run
   without a person has no `approve`.
6. **Validation lives in the handler,** against that handler's own schema, and a
   test holds every example in `describe` to the schema it would be validated
   against. That test is what keeps `describe` from drifting; nothing else can,
   because nothing else is checkable.

## Why nothing in the schema

One tool serves many actions and MCP publishes one schema per tool, so every way
of folding many contracts into one is wrong about something. Both ways were tried
in `interactive-instruction-mcp` and both failed, which is where this policy comes
from:

**Merging the actions' fields, keeping the first declaration of each name.** `id`
is the document to act on for fifteen actions and the category to list inside for
`list`; `list` is registered first, so the tool advertised "Parent ID to list
documents under" as the meaning of `id` for all of them. `sizeExemption` was
nullable on `update` and not on `add`, so `update(id, sizeExemption: null)` — the
documented way to remove that field — was rejected at the boundary while the
handler that would have accepted it never ran. No test could see either: a unit
test validates against the handler's own schema, which is the one dropped.

**A discriminated union on the action.** It expresses the whole thing exactly and
cannot be published. Measured against SDK 1.26.0: `registerTool` validates one
correctly, per-action required fields and all, and then publishes
`{"type":"object","properties":{}}`, because the conversion to JSON Schema does
not handle unions and returns nothing rather than failing. `server.tool` is worse
— it accepts a union, publishes the same empty object and validates nothing, so
the tool takes anything at all.

A schema that says nothing cannot be wrong about anything. And per-action detail
is cheaper in a document fetched when it is needed than in a tool list read on
every session: `interactive-instruction-mcp` went from 4,647 characters of
inputSchema to 146, which is about 1,150 tokens returned per session.

## `passthrough`, not an empty shape

They publish the same empty `properties` and behave oppositely. An empty shape
makes the SDK **discard every argument** before the handler runs, silently — a
tool that looks like it takes nothing and then does not take anything.
`passthrough` publishes `additionalProperties: true`, which says "arbitrary
arguments", and hands them all over.

## One op: the schema may list its fields

Everything above comes from one schema having to serve many ops. **A tool with
exactly one op has one contract, and may publish it**, so a caller sees the
required fields in the tool list without reading `describe` first. `report-mcp`
does this: what a report must contain is the point of the server, and a caller
that has to discover it by failing once has been told too late.

- Publish it from the `tools/list` handler, and register the tool `passthrough`
  as usual. A registered schema is validated by the SDK before the handler runs,
  and the SDK answers with its own error, so the handler's own problems (every
  one at once, each with its reason) never reach the caller.
- The published schema is the handler's schema, imported, not a copy. A test
  reads `tools/list` and checks the required fields.
- `describe` still exists and still says why each field is there.
- The moment a second op is added, the tool is back under rule 1.

## Arguments arrive as strings

**The price of an empty schema is that the handler, not the client, restores the
types.** A client converts a tool call's arguments using the tool's `inputSchema`.
For an argument that schema does not name, it has no type to convert to, and
sends the value as a string. Claude Code sends `recursive: true` as `"true"`,
`depth: 2` as `"2"` and `whenToUse: ["a"]` as `'["a"]'` -- however exactly the
model followed `describe`, because `describe` is read by the model and the
conversion is done by the client. `describe` cannot fix this; only the schema or
the handler can, and this policy has chosen the schema.

So a handler behind such a tool wraps every boolean, number and array in its
schema with `looseBoolean`, `looseNumber` and `looseArray` from `mcp-shared`.
They accept the string spelling and nothing looser. Without them, the documented
call fails: `list(recursive: true)` was rejected, and `add`, whose `whenToUse` is
required, could not be called from Claude Code at all.

`custom/no-strict-scalar-in-untyped-args` reports an unwrapped `z.boolean()`,
`z.number()` or `z.array()`. It is enabled per directory, for the handlers of
tools with an untyped schema; a server moving to this policy adds its handler
directory to that entry in `.oxlintrc.json`. `ast-typescript-mcp`'s `ts_ast`
already publishes a passthrough schema and is not yet wrapped or checked.

## Conformance

Measured by starting each server and reading `tools/list`. Servers needing
configuration to start are not listed; they are unmeasured, not conforming.

| server | `describe` | second tool | inputSchema | tools |
|---|---|---|---|---|
| `interactive-instruction-mcp` | `describe` | `instruction(action)` | **146 B** | 2 |
| `git-repo-explorer-mcp` | `git_describe` | `git_execute` | 360 B | 2 |
| `traceable-chain-mcp` | `chain_describe` | `chain_query` / `chain_mutate` | 497 B | 3 |
| `kroki-mcp` | `kroki_describe` | `kroki_render` | 629 B | 2 |
| `duckdb-mcp` | `duckdb_describe` | `duckdb_query` / `duckdb_count` | 1,500 B | 3 |
| `cli-to-mcp` | **none** (`cli_help`) | `cli_execute` / `cli_status` | 1,026 B | 3 |
| `ast-typescript-mcp` | **none** | `ts_ast` | 363 B | 1 |
| `interactive-pdca-mcp` | **none** | `plan` / `approve` | 6,401 B | 2 |
| `ast-file-mcp` | **none** | 14 tools | 7,014 B | 14 |

So: no server conforms. `interactive-instruction-mcp` meets every rule but the
name of its second tool. The work this implies, in the order the cost suggests:

1. **`ast-file-mcp`** — 14 tools, 7 KB of schema, no `describe`. Every rule broken
   at once, and the most expensive instance of each.
2. **`interactive-pdca-mcp`** — 6.4 KB and no `describe`. It also carries
   `input-schema-fields.ts` and `schema-consistency.test.ts`, which exist to keep
   two schemas in step; under this policy there is one schema, and both go.
3. **`ast-typescript-mcp`**, **`cli-to-mcp`** — no `describe`. `cli_help` may be
   one under another name; if so it is a rename, and if not it is a new tool.
4. **The prefixed four** — `git_describe`, `chain_describe`, `kroki_describe`,
   `duckdb_describe` become `describe`. Breaking for anything naming them.
5. **Every second tool** becomes `exec`, and its operations become `op` values:
   `instruction(action)`, `git_execute`, `kroki_render`, `duckdb_query` /
   `duckdb_count`, `cli_execute` / `cli_status`. `chain_mutate` and any other
   tool holding operations a person must approve becomes `approve`, not `exec`.
   Breaking for anything naming them.
6. **Every schema above 146 B** — the argument information comes out.

Each of these, as it drops its argument information, takes on the section above:
its handlers' booleans, numbers and arrays get the loose wrappers, and its handler
directory goes into the lint override.

`coding-rules__schema-sync` predates this and says the opposite: it takes two
schemas as given and prescribes a checklist and a consistency test for keeping
them together. That document is superseded for any server following this policy,
and is what `interactive-pdca-mcp`'s machinery was built from.
