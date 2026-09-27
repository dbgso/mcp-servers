---
description: Write the criterion before writing the check. A rule that detects a violation of something unwritten teaches nothing.
whenToUse:
  - Adding a lint rule or a validation
  - Responding to a finding nobody can act on
  - Deciding whether to enforce a convention
---

# The criterion comes before the detection

**Write down what the shape should be. Then, separately, decide whether to detect
departures from it.** In that order, and the second is optional.

A check whose criterion is unwritten reports something the reader cannot act on,
so they act on the report instead: they make the finding go away. That is how
`orphaned-document` — which said only "not referenced by any other document" —
produced a corpus where one document had three of its four parents among its own
children. The direction was never a free choice (the rule counts inbound edges, so
parent-to-child leaves only the entry points unreferenced), but nothing said so, so
edges went whichever way silenced it. No cycle, nothing reported, unreadable.

## What this asks for

1. **The criterion is a document,** not a rule's error message. It says what the
   shape is and why, including the cases it does not cover.
2. **A finding names the criterion,** and the call that answers it. "Not
   referenced by any other document" became "Add it to the `relatedDocs` of the
   document it belongs under — edges run parent to child."
3. **Detection is a separate decision.** Some criteria are worth enforcing, some
   are worth only writing down, and conflating the two means a convention has to
   earn a lint rule before it is allowed to exist.

## The failure this prevents

A finding that cannot be acted on correctly is worse than no finding: it is a
prompt to do something, and the something a reader invents is usually whatever
stops the prompt. Silence would have left the corpus alone.
