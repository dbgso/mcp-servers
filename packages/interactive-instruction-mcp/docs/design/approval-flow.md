---
description: Why promotion asks for an explanation rather than a confirmation, and what that does and does not buy
whenToUse:
  - questioning the approval flow
  - deciding whether this gate is strong enough for a corpus
  - adding a gated operation
relatedDocs:
  - specification__draft-workflow
---

# Approval Flow Design

Why promotion asks for an explanation rather than a confirmation.

**Related specification:** `specification__draft-workflow`

## Problem

An agent could write documentation the user never understood. A confirmation
step does not fix that: the agent can say "approve the above" without having
explained anything.

## Solution: make the agent say it first

### Why the tool does not show the content

If the tool prints the document, the explanation can be skipped -- the agent
points at the output instead of describing the change. So `approve` asks for
`notes` first, which cannot be produced without reading the document.

### Why the first attempt is refused

The refusal is where the preview appears: what would change, the target, whether
anything is overwritten. Seeing that and being asked to explain it are the same
moment, and separating them only meant the explanation was written after the
decision had been made.

Only an identical repeat goes through, and the run is keyed on the operation, the
tool-computed change and the explanation verbatim -- so a repeat that quietly
changed the target or the wording is a new run, refused from attempt one.

## Be precise about what this buys

**Disclosure, not consent.** Nothing here verifies that a human read anything.
An agent that has been refused can open a fresh run for a different change and
push it through at the cost of one more round. What carries the risk instead is
reversibility: `rename` moves every backlink in one operation that can be run
backwards, `apply` refuses a diff whose document has moved under it, and a
delete is refused twice with the links it would break named.

A corpus where an uncooperative agent getting through would be genuinely
damaging needs a different gate; `mcp-shared`'s token strategy is still there to
install.

## Alternatives considered

| Approach | Rejected because |
|----------|------------------|
| Show the content at creation | The agent points at it instead of explaining |
| No self-review notes | Nothing forces the agent to read what it wrote |
| Preview before the explanation | The user reads the diff instead of hearing the reason |
| A one-time token delivered out of band | Cannot be delivered in a headless or SSH session, which is where this server mostly runs |
