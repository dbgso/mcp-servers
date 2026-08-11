# traceable-chain-mcp

Enforce traceability in your documentation. Every document must link to its parent.

## The Problem

In software projects, documentation often becomes disconnected:
- Specs that don't trace back to requirements
- Designs with no link to specs
- Decisions made without documented context

When something breaks, you can't trace back to understand *why* it was built that way.

## The Solution

traceable-chain-mcp enforces a **dependency chain**:

```
requirement → spec → design → implementation
                 ↘
                   test
                     ↘
                       proposal → adr
```

Every document **must** link to a parent. No orphan specs. No untraceable decisions.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  requirement: "User Authentication"                         │
│  id: 01HQXK2A8N...                                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  spec: "OAuth2 Integration"                                 │
│  id: 01HQXK3V7M...                                          │
│  requires: 01HQXK2A8N...  ← enforced link                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  design: "Token Flow Design"                                │
│  id: 01HQXK4B9P...                                          │
│  requires: 01HQXK3V7M...  ← enforced link                   │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npx traceable-chain-mcp
```

Documents are stored in `./docs/chain/` as markdown with YAML frontmatter:

```markdown
---
id: 01HQXK3V7M...
type: spec
requires: 01HQXK2A8N...
title: OAuth2 Integration
created: 2024-01-15T10:30:00Z
updated: 2024-01-15T10:30:00Z
---

## Overview

This spec describes the OAuth2 integration for user authentication...
```

## Tools

### Query Operations (chain_query)

| Operation | Description |
|-----------|-------------|
| `read` | Read a document by ID |
| `list` | List all documents (optionally filter by type) |
| `trace` | Trace dependency tree (up to ancestors or down to descendants) |
| `validate` | Check all documents for valid dependencies |

### Mutate Operations (chain_mutate)

| Operation | Description |
|-----------|-------------|
| `create` | Create a new document (must specify parent for non-root types) |
| `update` | Update title or content |
| `delete` | Delete a document (fails if other documents depend on it) |
| `link` | Add a dependency link to a parent document |

## Usage Examples

### Create a requirement (root document)

```json
{
  "operation": "create",
  "params": {
    "type": "requirement",
    "title": "User Authentication",
    "content": "Users must be able to log in using OAuth2 providers..."
  }
}
```

### Create a spec (must link to requirement)

```json
{
  "operation": "create",
  "params": {
    "type": "spec",
    "requires": "01HQXK2A8N...",
    "title": "OAuth2 Integration Spec",
    "content": "## Scope\n\nThis spec covers..."
  }
}
```

**Without `requires`?** → Error. Specs must trace to requirements.

### Trace dependencies

```json
{
  "operation": "trace",
  "params": {
    "id": "01HQXK4B9P...",
    "direction": "up"
  }
}
```

Returns the full ancestry chain:
```json
{
  "id": "01HQXK4B9P...",
  "type": "design",
  "title": "Token Flow Design",
  "children": [
    {
      "id": "01HQXK3V7M...",
      "type": "spec",
      "title": "OAuth2 Integration",
      "children": [
        {
          "id": "01HQXK2A8N...",
          "type": "requirement",
          "title": "User Authentication",
          "children": []
        }
      ]
    }
  ]
}
```

## Default Type Configuration

```yaml
types:
  requirement:
    requires: null  # root type
    description: Business requirement

  spec:
    requires: requirement
    description: Technical specification

  design:
    requires: spec
    description: Implementation design

  implementation:
    requires: design
    description: Implementation notes

  test:
    requires: [spec, design]  # can link to either
    description: Test plan or results

  proposal:
    requires: [requirement, spec, design, implementation]
    description: Decision proposal/option

  adr:
    requires: proposal
    description: Architecture Decision Record
```

## Custom Configuration

Create `chain.config.yaml`:

```yaml
types:
  epic:
    requires: null
    description: High-level epic

  story:
    requires: epic
    description: User story

  task:
    requires: story
    description: Implementation task

storage:
  basePath: ./docs/project
  extension: .md
```

## Why Traceability Matters

| Without Traceability | With Traceability |
|---------------------|-------------------|
| "Why was this built?" | Trace back to requirement |
| "What's affected if I change this spec?" | Trace down to implementations |
| "Is this decision documented?" | ADRs linked to proposals |
| Orphan documents everywhere | Every document has context |

## Claude Code Configuration

```json
{
  "mcpServers": {
    "chain": {
      "command": "npx",
      "args": ["traceable-chain-mcp"]
    }
  }
}
```

## License

MIT
