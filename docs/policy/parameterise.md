---
description: If a value needs deciding and can be read from the environment, it is configuration with a default, not a discussion.
whenToUse:
  - Choosing a threshold, limit or timeout
  - Reviewing a number hard-coded in a rule
  - Being asked what a default should be
---

# Parameterise rather than decide

A value that has to be chosen, and that a caller could reasonably want different,
**is configuration with a default.** Not a constant, and not a conversation.

The test is two questions. Does it need deciding? Could it be read from the
environment? Two yeses means the answer is a default plus an environment variable,
and the discussion that would have set the constant is not worth having.

## Why

A threshold that is right for this repository is wrong for another one, and
neither is a defect. `lint`'s 150-line limit suits a corpus of task cards and
reads as noise to one of runbooks; 60% overlap is the same. Arguing the number
settles it for one corpus and leaves every other one wrong.

`IIMCP_LINT_MAX_LINES`, `IIMCP_LINT_SIMILARITY`, `IIMCP_LINT_MIN_DUPLICATE_LINES`
and `IIMCP_DELIBERATION_ATTEMPTS_<OP>` are all this. Each has a default that is
what this repository wanted, and none of them needed agreeing on.

## Rules

- **The default is the answer for here.** Not a neutral middle; the value this
  repository would have chosen anyway.
- **An unreadable or out-of-range value falls back to the default rather than
  throwing.** A typo in an environment variable must not stop a server starting.
- **Say the name where the value is used.** A message that reports a threshold
  names the variable that moves it, so the reader can act without going looking.
