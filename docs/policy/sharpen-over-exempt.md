---
description: An exemption field belongs only where the rule cannot know the answer. Where the answer is derivable, sharpen the rule instead.
whenToUse:
  - A rule reports something that is not a defect
  - Considering an exemption or opt-out field
  - Deciding whether a false positive is the rule's fault or the document's
---

# Sharpen the rule before offering a way out

A rule that reports things which are not defects has two possible fixes: let the
subject declare an exemption, or make the rule decide correctly. **Take the second
unless the rule cannot possibly have the answer.**

## The test

**Can the answer be derived from what the rule already sees?**

- **No** — the answer needs knowledge the rule has no access to. `document-too-large`
  is this: whether a reference table is worth more in one piece than split across
  three files depends on what it says, and no amount of counting lines reaches it.
  `sizeExemption` is correct, and it takes a *reason* rather than a flag, so the
  next reader can tell a decision from a warning nobody got to.
- **Yes** — the rule is wrong, not the subject. `duplicate-heading` was this: it
  counted a heading by text and level and ignored what it sat under, so a
  specification writing `### Endpoint` once per feature was reported for every one.
  Whether two identically-named subsections are the same section is decidable from
  the document's structure. Comparing the ancestry fixed it; an exemption field
  would have asked a person to answer a question the rule could answer itself.

**Asking for a reason where the answer is derivable is making a person do the
rule's work.**

## Why an exemption costs more than it looks

Measured, on the one exemption this repository has. Adding `sizeExemption` created
three follow-on rules, each policing the escape hatch rather than the thing the
original rule was about:

| rule | exists because |
|---|---|
| `size-exemption-without-reason` | an exemption with no reason is a mute button |
| `stale-size-exemption` | an exemption outlives the reason for it |
| refusing `"null"` as a reason (2.0.2) | a client that stringifies arguments stored the word |

One way out, three rules to keep it honest. The same three would have been needed
for a `duplicateHeadingExemption`.

## And it does not improve the signal

In the corpus that prompted this, `duplicate-heading` produced 11 findings, none of
them defects, and **one** real one: a document with `## Security` twice under the
same parent, which was nearly missed among them. An exemption marks the 11 as
handled and leaves the 1 exactly where it was. Sharpening the rule removed the 11
and left the 1 alone on the page.
