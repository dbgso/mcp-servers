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

`coding-rules__schema-sync` predates this and says the opposite: it takes two
schemas as given and prescribes a checklist and a consistency test for keeping
them together. That document is superseded for any server following this policy,
and is what `interactive-pdca-mcp`'s machinery was built from.
