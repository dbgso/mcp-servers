---
description: The states a draft passes through and what moves it between them
whenToUse:
  - understanding why a draft cannot be promoted yet
  - reading a workflow state in frontmatter
  - changing the approval flow
---

# Draft Workflow Specification

The state a draft is in, and what moves it.

## States

| State | What it means |
|-------|---------------|
| `editing` | The draft exists and has not been submitted for review |
| `self_review` | `add` or `update` has run; the agent's own review is not recorded yet |
| `user_reviewing` | The self-review is recorded; the change has not been explained to the user |
| `pending_approval` | Explained once and refused once; the identical repeat will promote it |
| `applied` | Promoted. The workflow entry is deleted at this point |

## Transitions

| From | To | Trigger |
|------|----|---------|
| `editing` | `self_review` | `instruction(action: "add", ...)` or `update` on the draft |
| `self_review` | `user_reviewing` | `instruction(action: "approve", id, notes: "<self-review>")` |
| `user_reviewing` | `pending_approval` | `instruction(action: "approve", id, explanation: "...")` -- refused, on purpose |
| `pending_approval` | `applied` | The identical call repeated |
| any | `editing` | `instruction(action: "set_status", id, status: "editing")` |

There is no approval token and no notification. The first `approve` carrying an
`explanation` is refused and shows what would change; only an identical repeat
goes through. The refusal is an ordinary response, not an error: being refused
is a step in the operation rather than a failure of it.

`set_status` accepts `editing` and nothing else. It discards the workflow entry,
so the draft starts its review over.

## What the state is stored in

Process memory backed by a directory outside the corpus, scoped per documents
directory (`MCP_DRAFT_PERSIST_DIR`). It is deleted on promotion: a later draft
reusing the same id starts from `editing` rather than inheriting a state it
never earned.

The frontmatter mirrors it (`status`, `selfReviewNotes`, `confirmedAt`) while the
draft is alive, and promotion removes those keys from the published document --
they exist to run the approval conversation, not to be read by anyone after it.
`approvedAt` is added instead, because when a document joined the corpus is a
fact about the document.
