---
description: A tool's schema carries no argument information; a describe tool carries all of it. Every server has one, and it is called describe.
whenToUse:
  - Registering a tool on an MCP server
  - Deciding what a tool's inputSchema should contain
  - Adding or renaming a describe tool
  - Reviewing a server whose schema lists its arguments
---

# The tool surface

**A tool publishes no information about its arguments. `describe` publishes all of
it.** The schema accepts anything; the handler decides what is valid; `describe`
says what the handler wants.

## The four rules

1. **A tool's `inputSchema` names no argument.** It is `z.object({}).passthrough()`.
2. **Every server registers a `describe` tool.** A server without one is
   incomplete, not minimal.
3. **It is called `describe`,** with no prefix. The server name is already the
   namespace: a caller reaches it as `mcp__<server>__describe`, so a prefix inside
   the tool name says the same thing twice.
4. **Validation lives in the handler,** against that handler's own schema, and a
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

| server | `describe` | inputSchema | tools |
|---|---|---|---|
| `interactive-instruction-mcp` | `describe` | **146 B** | 2 |
| `git-repo-explorer-mcp` | `git_describe` | 360 B | 2 |
| `traceable-chain-mcp` | `chain_describe` | 497 B | 3 |
| `kroki-mcp` | `kroki_describe` | 629 B | 2 |
| `duckdb-mcp` | `duckdb_describe` | 1,500 B | 3 |
| `cli-to-mcp` | **none** (`cli_help`) | 1,026 B | 3 |
| `ast-typescript-mcp` | **none** | 363 B | 1 |
| `interactive-pdca-mcp` | **none** | 6,401 B | 2 |
| `ast-file-mcp` | **none** | 7,014 B | 14 |

So: one server conforms. The work this implies, in the order the cost suggests:

1. **`ast-file-mcp`** — 14 tools, 7 KB of schema, no `describe`. Both rules broken
   at once, and the most expensive instance of each.
2. **`interactive-pdca-mcp`** — 6.4 KB and no `describe`. It also carries
   `input-schema-fields.ts` and `schema-consistency.test.ts`, which exist to keep
   two schemas in step; under this policy there is one schema, and both go.
3. **`ast-typescript-mcp`**, **`cli-to-mcp`** — no `describe`. `cli_help` may be
   one under another name; if so it is a rename, and if not it is a new tool.
4. **The prefixed four** — `git_describe`, `chain_describe`, `kroki_describe`,
   `duckdb_describe` become `describe`. Breaking for anything naming them.
5. **Every schema above 146 B** — the argument information comes out.

Each of these, as it drops its argument information, takes on the section above:
its handlers' booleans, numbers and arrays get the loose wrappers, and its handler
directory goes into the lint override.

`coding-rules__schema-sync` predates this and says the opposite: it takes two
schemas as given and prescribes a checklist and a consistency test for keeping
them together. That document is superseded for any server following this policy,
and is what `interactive-pdca-mcp`'s machinery was built from.
