---
description: When a mistake should stop happening, reach for the cheapest constraint that can express it, in the order type, lint, custom lint, test, iimcp rule.
whenToUse:
  - Deciding how to stop a mistake recurring
  - Considering a new lint rule or a new test
  - About to write a rule into an iimcp document
  - Reviewing a fix that only tells a future reader to be careful
---

# The constraint ladder

A mistake worth preventing gets a constraint. **Take the highest rung that can
express it:**

1. **A type.** The mistake becomes a compile error.
2. **A lint rule that exists.** Turn it on, or turn it up.
3. **A custom lint rule.** Written once in `eslint-rules/`, checked on every file.
4. **A test.** Runs, and can be made to fail on purpose.
5. **A rule in an iimcp document.** Read by whoever is working, and only that.

Go down a rung only when the rung above cannot say it. Not when it would take
longer to write: the ladder is ordered by **when the mistake is caught and how
certainly**, and every rung down widens the window and weakens the guarantee.

## Why this order

A type is checked before the code runs, on every build, for everyone, and cannot
be forgotten. `InstructionAction` is derived from the handler list —
`(typeof HANDLERS)[number]["action"]` — so suggesting an action that no handler
registers is a compile error, and renaming one is an error everywhere it was not
renamed. No test was needed for that class of mistake and none can be forgotten.

Lint is next because it is still mechanical and still runs on everything, one step
later. A custom rule is the same guarantee for something no off-the-shelf rule
covers: `custom/no-branching-literal` and `custom/single-params-object` exist
because the thing they catch is a house convention.

A test is below lint because it constrains only what it exercises. `999` uncovered
lines and a rule you can grep for are different kinds of safety.

An iimcp rule is last because it binds nobody. It is instruction, not enforcement,
and it holds only as long as whoever is working reads it and remembers. That is
worth a great deal — it is where the *reasons* live, and a reason is not
expressible in a type — but reaching for it first means choosing the weakest
available guarantee.

## What this rules out

- Writing a documentation rule for something a type could have made impossible.
- Adding a test for something lint already checks, or would with one option on.
- "Be careful with X" as the outcome of a review, when X has a shape.

## When the bottom rung is right

Something no static check can see: why a threshold is 150 rather than 120, why a
long document stays whole, which direction `relatedDocs` edges run and what that
buys. `policy` and `coding-rules` are full of these, correctly. The test is whether
a machine could have decided it — see `policy__sharpen-over-exempt`, which is the
same question asked about lint findings.
