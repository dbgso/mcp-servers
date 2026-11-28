# traceable-chain-mcp

Carry every decision down one level at a time, from philosophy to code, and walk every change back up to the root.

An MCP server and a CLI over the same core.

## The Problem

In software projects, documentation becomes disconnected, and then it goes stale:
- Specs that don't trace back to requirements, requirements that serve no stated philosophy
- A spec rewritten while the designs below it still describe the old one
- Code changed without anyone checking whether the design, the spec, or the requirement still hold

When something breaks, you can't trace back to understand *why* it was built that way, and you can't tell which documents are still true.

## The Solution

**Decisions are made from the top.** A philosophy decides requirements, a requirement decides specs, a spec decides designs, a design decides the implementation, and the implementation is bound to code:

```
philosophy → requirement → spec → design → implementation ──▶ code
                             ↘        ↘
                               test ──────▶ test code
          (any level) → proposal → adr
```

1. **Every document links to its parent(s).** No orphan specs, no untraceable decisions.
2. **Every link remembers what both ends said** when it was last confirmed (a content hash of each side).
3. **Any change makes its links suspect**, upward (does it still satisfy its parent?) and downward (do the children still follow from it?). Code bound to an implementation is hashed too, so a code change is caught the same way.
4. **Suspicion is cleared top-down.** `confirm` refuses while anything above is unresolved. If a level does not hold, you change it, and that change is now suspect one level up. The walk continues until a level holds or the root is reached.
5. **It is all mechanical.** `traceable-chain check` exits 1 when anything is unresolved, so CI or a pre-commit hook can stop the change.

## Quick Start

```bash
npx traceable-chain-mcp            # MCP server (stdio), documents in ./docs/chain
npx traceable-chain check          # CLI, same documents
```

Documents are stored in `./docs/chain/<type>/<id>.md` as markdown with YAML frontmatter:

```markdown
---
id: 01HQXK4B9P...
type: implementation
title: Token handling
requires: 01HQXK3V7M...          # one parent; a list when there are several
created: 2024-01-15T10:30:00Z
updated: 2024-01-15T10:30:00Z
baseline:                        # written by the tool
  01HQXK3V7M...:
    parent: 9c1e0f2a77d4b3e1     # the parent's hash when this link was confirmed
    self: 4b0a6d1c98e2f5a0       # this document's hash at that time
    at: 2024-01-15T10:30:00Z
code:                            # written by bind_code
  - path: src/auth/              # file, directory or glob, relative to the code root
    hash: 1f9d2c3b4a5e6f70
---

## Overview
...
```

The hash covers the title and body only. Frontmatter is excluded, so confirming a link never counts as a change.

## The Change Workflow

```
code changed ──▶ check: code_changed on implementation "Token handling"
                 Walk up:
                   ▶ implementation "Token handling"
                       ↑ design "Token flow"
                       ↑ spec "OAuth2 Integration"
                       ↑ requirement "User Authentication"
                       ↑ philosophy "Fewer moving parts"
```

At each level, re-read the document against the one above:

- **It still holds** → `confirm` it. The walk stops here.
- **It does not** → the level above is wrong. Update that document. Now `check` shows it as `self_changed` (it must still satisfy *its* parent) and every child as `parent_changed`. Keep going up until a level holds, then come back down, confirming or updating each child, until the code.

`confirm` enforces the order: it fails while anything above the document is unresolved, and names the topmost document to settle first.

Use `impact` before you change anything to see what the change must satisfy (upstream, to the root) and what it can invalidate (downstream).

## What `check` Reports

| Finding | Severity | Meaning |
|---------|----------|---------|
| `parent_changed` | error | The parent changed after this link was confirmed |
| `self_changed` | error | This document changed after its link was confirmed |
| `unreviewed_link` | error | The link has never been confirmed (e.g. a document written before baselines existed) |
| `code_changed` | error | Bound code changed after it was confirmed |
| `code_missing` | error | A bound path matches no files |
| `code_unreviewed` | error | A bound path has no hash yet |
| `missing_parent` / `parent_not_found` / `invalid_parent_type` / `root_has_parent` | error | The chain is malformed |
| `cycle` | error | Following parents comes back around |
| `unknown_type` / `invalid_file` | error | A document the config or the parser does not accept |
| `unrealized` | warning | No child of the `realizedBy` type exists: a decision not carried down |
| `no_code` | warning | A type that binds code is bound to none |

Each document with drift or a broken upward link is listed in `escalations` with its ancestors to the root, and `actionable: true` when everything above it is settled.

## MCP Tools

### chain_query (no approval)

| Operation | Description |
|-----------|-------------|
| `read` | Read a document by ID |
| `list` | List all documents (optionally filter by type) |
| `trace` | Dependency tree up (ancestors) or down (descendants); suspect nodes are marked |
| `validate` | Structural checks only (types and parents) |
| `check` | Every check above, with escalations |
| `impact` | Upstream and downstream of a document or a code path |

### chain_mutate (approval required)

| Operation | Description |
|-----------|-------------|
| `create` | Create a document; non-root types need `requires` (an ID or a list). Links are confirmed at creation |
| `update` | Update title or content. Baselines are left alone, so the change shows up in `check` |
| `delete` | Delete a document (fails if other documents depend on it) |
| `link` | Add a parent (existing parents are kept). Refuses cycles. Confirmed as it is made |
| `unlink` | Remove a parent; a non-root document keeps at least one |
| `confirm` | Record that a document still holds against its parents and code. `target`: one parent ID, or `"code"` |
| `bind_code` | Bind a document (of a type with `bindsCode`) to files, directories or globs |
| `baseline` | Give every never-confirmed link and code path a baseline from the current state |

### chain_describe

Lists types and operations; `{ operation: "guide" }` explains the workflow for an AI agent.

## CLI

```
traceable-chain check [--json] [--strict]        exit 1 on errors (--strict: also warnings)
traceable-chain impact <id|path> [--json]
traceable-chain trace <id> [--up] [--json]
traceable-chain list [--type <type>] [--json]
traceable-chain confirm <id> [--target <parent-id|code>]
traceable-chain bind <id> <path...> [--replace]
traceable-chain link <id> <parent-id>
traceable-chain unlink <id> <parent-id>
traceable-chain baseline

Options: --dir <path> (document directory), --config <file>
```

A pre-commit hook or CI step:

```bash
npx traceable-chain check --dir docs/chain
```

## Adopting Existing Documents

Documents written before baselines existed report `unreviewed_link`. Run `traceable-chain baseline` once to accept the current state as confirmed. With the default config, requirements also need a philosophy above them: create one and `link` each requirement to it.

## Default Type Configuration

```yaml
types:
  philosophy:
    requires: null              # root type
    realizedBy: requirement
  requirement:
    requires: philosophy
    realizedBy: spec
  spec:
    requires: requirement
    realizedBy: design
  design:
    requires: spec
    realizedBy: implementation
  implementation:
    requires: design
    bindsCode: true
  test:
    requires: [spec, design]    # can link to either
    bindsCode: true
  proposal:
    requires: [philosophy, requirement, spec, design, implementation]
    realizedBy: adr
  adr:
    requires: proposal
```

- `requires`: the allowed parent type(s); `null` for a root
- `realizedBy`: the child type that carries this decision down; missing one is an `unrealized` warning
- `bindsCode`: documents of this type can be bound to code, and an unbound one is a `no_code` warning

## Custom Configuration

Create `chain.config.yaml` (also `.yml`, `.json`, `.chain.yaml`, …) in the working directory:

```yaml
types:
  vision:
    requires: null
    realizedBy: epic
  epic:
    requires: vision
    realizedBy: story
  story:
    requires: epic
    realizedBy: task
  task:
    requires: story
    bindsCode: true

storage:
  basePath: ./docs/project   # relative to this file
  extension: .md

codeRoot: .                  # code paths are relative to this (default: this file's directory)
```

Without a config file, code paths are relative to the working directory.

## Claude Code Configuration

```json
{
  "mcpServers": {
    "chain": {
      "command": "npx",
      "args": ["traceable-chain-mcp", "./docs/chain"]
    }
  }
}
```

## License

MIT
