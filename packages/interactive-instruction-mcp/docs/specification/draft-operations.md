---
description: What each action of the instruction tool does, per document state
whenToUse:
  - deciding which action to call
  - checking whether an action covers drafts
  - changing a handler's behaviour
relatedDocs:
  - specification__draft-workflow
  - specification__file-structure
  - specification__frontmatter-format
---

# Document Operations Specification

What each action does, and which state it applies to.

Every action is a call on the one `instruction` tool. `instruction_describe()`
lists them with their arguments; this document is about the behaviour behind
them.

## Creating

`instruction(action: "add", id, content, description, whenToUse, relatedDocs?)`

- Writes `_mcp_drafts/{id}.md`. The result is always a draft
- `description` and `whenToUse` are required: a document nobody can find is a
  document nobody reads
- Frontmatter written inside `content` is kept; the arguments win where both say
  something
- The response reports the document's own lint findings (size, repeated
  headings, missing metadata). The write succeeds either way

## Changing

`instruction(action: "update", id, content?, description?, whenToUse?, relatedDocs?)`

| State | Behaviour |
|-------|-----------|
| Draft | Overwritten directly |
| Promoted | Stages a diff; `apply` writes it, `cancel` discards it |

`content` is optional. Omitting it changes the metadata and leaves the body
alone -- resending a whole document to fix one `whenToUse` entry was why
metadata went unmaintained. `relatedDocs` replaces the list; `link_add` and
`link_remove` are the incremental pair.

## Removing and renaming

| Action | Draft | Promoted |
|--------|-------|----------|
| `delete` | Immediate | Refused twice, with the links it would break named, then removed |
| `rename` | Immediate | Refused twice, then renamed with every backlink rewritten in the same operation |

A promoted delete is not recoverable from this server. What puts the document
back is the corpus's own version control, and the response says so.

## Promoting

`instruction(action: "approve", id, notes)` records the self-review.
`instruction(action: "approve", id, explanation)` promotes it -- refused once,
then carried out on the identical repeat. `targetId` promotes onto a different
id; `ids` promotes several under one explanation, and requires every one of them
to have had its self-review recorded first.

## Reading

| Action | What it answers |
|--------|-----------------|
| `read` | The prose. No frontmatter, for a draft or a promoted document |
| `read_meta` | The metadata, its neighbours in the `relatedDocs` graph, and what better metadata would say. Writes nothing |
| `list` | The promoted corpus. `drafts: true` lists drafts instead, by the plain id every other action takes |
| `lint` | Quality checks. See `specification__file-structure` for which ones reach a draft. `document-too-large` is answered with `update(id, sizeExemption: "<why>")` and `sizeExemption: null` removes it; `duplicate-heading` counts a heading as repeated only under the same ancestry |
| `backlinks` | Which promoted documents reference one document, in one hop, with their descriptions. `id` is required |

`relatedDocs` edges run **parent to child**: a document lists the documents under it.
`orphaned-document` counts inbound edges, so this direction leaves only the corpus's entry
points unreferenced, while child to parent leaves every leaf unreferenced -- and silencing
that is how a corpus ends up with a document's parents among its own children. Two parents
are allowed and suggest the document belongs one level up; cycles are reported. The directory
hierarchy is a separate axis, carried by the id and drawn as node colour, and is not repeated
in `relatedDocs`. `instruction_describe` states all of this to the caller.

`approve`'s `targetId` and `notes` are single-promotion arguments. The batch form
(`ids`) refuses a call carrying either: `targetId` names one document, and `notes` is one
draft's self-review while the batch already requires each draft to have its own. Both used
to be accepted and dropped.

There was a third, `force`, which suppressed the consecutive-approval warning. That
warning is a note appended to the answer now rather than a refusal -- what it protects is
the account the user gets, not the safety of the write, which the deliberation gate holds
either way -- so there is nothing left to suppress and the argument is gone.
| `graph` | The `relatedDocs` graph of the promoted corpus, as a page or as text. `depth` walks further than one hop. `format: "text"` refuses `layout`, `direction`, `spacing` and `edgeStyle`, which only reach the drawing; `outputPath` writes the text there |
