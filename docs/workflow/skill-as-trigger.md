---
description: A skill is a trigger, not a place to keep rules. Its body is one line pointing at the iimcp document that holds them.
whenToUse:
  - Creating an agents skill
  - Deciding where a repeated procedure should be written down
  - Finding the same instructions in a skill and a document
---

# A skill triggers; iimcp remembers

Routine work gets a skill, because a skill is what fires on the right words
without anyone deciding to go looking. **Its body is one line: use the iimcp rule
that holds the procedure.** The procedure itself does not live in the skill.

```markdown
Follow `workflow__<the-rule>` from interactive-instruction-mcp.
```

## Why split them

A skill is the better **trigger**. It is invoked by name, it fires on a phrase,
and it arrives without being searched for.

iimcp is the better **keeper**:

- **One copy.** Two skills covering related work would otherwise each carry their
  own version of the same steps, and the versions drift apart silently. A document
  is referenced by both.
- **`lint` reads it.** A document that is too long, has no `whenToUse`, duplicates
  another document's passage, or that nothing links to gets reported. A skill's
  body gets none of that.
- **It reminds.** The reminder block is appended to every response, and
  `--topic-for-every-task` makes a named rule unavoidable rather than
  discoverable. A skill says nothing until it fires.
- **It is reviewable as content.** A rule that changes goes through `update` and
  the approval flow, with a diff, like any other document.

## So

A skill whose body grew past the one line has started keeping rules, and the rules
belong in a document the skill points at. Two skills sharing three paragraphs have
already drifted, whether or not it shows yet.
