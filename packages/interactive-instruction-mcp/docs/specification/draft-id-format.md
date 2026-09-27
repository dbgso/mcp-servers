---
description: What a document id may contain, and how it maps to a path
whenToUse:
  - validating or generating an id
  - debugging a path that resolved wrongly
  - working with the draft prefix
---

# Document ID Format Specification

An id is how every action names a document, and it is also a path fragment --
which is why it is validated rather than trusted.

## Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| Alphanumerics, hyphens, underscores | `my-doc_01` | `my doc!` |
| Non-empty | `overview` | `` |
| No path separator | `api__v2` | `api/v2` |
| No traversal | `notes` | `..__home__.claude__CLAUDE` |

The last row is the reason this is a specification and not a style guide. An id
resolves to a file path, so one containing `..` reached outside the documents
directory entirely -- and since nothing about `update` names the file it will
write, that was an undisclosed overwrite of any `.md` file the process could
reach.

Lowercase is a convention, not a rule.

## Hierarchy

`__` maps to a directory separator:

| Id | Path |
|----|------|
| `overview` | `overview.md` |
| `specification__draft-workflow` | `specification/draft-workflow.md` |
| `api__v2__endpoints` | `api/v2/endpoints.md` |

The separator is segment-aware everywhere it is tested: `_mcp_draftsy__topic` is
an ordinary document that happens to begin with the same letters as the internal
directory.

## The draft prefix

A draft is stored under `_mcp_drafts__{id}`, which is `_mcp_drafts/{id}.md` on
disk. **That prefix is storage, not a name.** Every action takes the plain id,
`relatedDocs` holds plain ids, and `lint` prints the plain id with `(draft)`
after it. The prefixed form is accepted where a caller might plausibly paste it
back, and produces the same answer.

## The extension

`.md` is added on write and must not be part of the id.
