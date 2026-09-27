---
description: A family of documents gets one document that indexes it, at the family's own id, and everything outside the family points at that instead of at its members.
whenToUse:
  - Adding a document whose id shares a parent with others
  - Deciding whether a family of documents needs a hub
  - Writing or updating a hub, and deciding what belongs in it
  - Being told by `prefer-hub-reference` or `stale-hub-index` what to do about it
relatedDocs:
  - workflow__dry-principle
---

# The hub, not the list

Ids carry a hierarchy: `workflow__constraint-ladder` sits under `workflow`. When
more than one document shares a parent, that parent is a **family**, and the
family gets one document that indexes it -- the **hub**.

Everything outside the family points at the hub. Only the hub names the members.

## When a family needs one

At two members, if anything outside the family needs to reach them.

One reference to one document is a citation: it means that document and no other,
and sending the reader to a hub instead would lose which one was meant. It is the
second that turns a passage into a list, and a list written outside the family is
a second copy of the index. The copy is not maintained -- nobody remembers it when
a document is added -- so it drifts, and the drift is silent.

Two is a default, not a law: `IIMCP_LINT_HUB_CHILDREN` moves it. Where a corpus
draws the line between citing two documents and indexing them is a property of the
corpus.

## The hub is the document at the family's id

`coding-rules.md`, not `coding-rules/overview.md`. An `overview` or `index` inside
the directory is a **sibling** of the documents it means to index -- the id
hierarchy makes it one, whatever the file is called -- so nothing can tell it apart
from its own children, a reference to it does not count as a reference to the
family, and a tool asked for "the family's document" does not find it.

## What it contains

Every member, and one line each saying what that member decides.

Not a summary of them: two accounts of the same rule disagree the first time one is
edited, and the hub is the copy nobody rereads. One line is enough to choose
between them, which is all the hub is for. Anything worth more than a line belongs
in the member.

## Why the hub and not the list

The hub is what everything else is sent to read, so the hub being wrong is the one
error nothing else catches. That is the whole cost of this arrangement and it is
worth paying, because the alternative -- every document keeping its own list -- has
the same failure once per list.

`every-task` named five `workflow__*` rules one by one, before `workflow` existed.
The reason it was wrong was written down while removing it, and nothing was left
that would catch the next one.

## What reports it

- `prefer-hub-reference` -- a document names several members of one family. It says
  to point at the hub, or to write the hub when the family has none.
- `stale-hub-index` -- a hub's list and the directory disagree: a member it never
  names, or a name with no member behind it.
- `misplaced-hub` -- an `overview`, `index` or `readme` inside a family that has no
  hub. Nothing else reaches this one: `stale-hub-index` needs a document at the
  family's id to check, and not having one is the defect.

Both read `relatedDocs` and the prose alike, so `` See `workflow__dry-principle` ``
in a body counts as a reference.
