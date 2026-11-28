---
description: Where a claim can be measured, measure it. An argument from how something ought to behave is not evidence about how it does.
whenToUse:
  - Reasoning about performance, cost or capability
  - Choosing between designs on their expected behaviour
  - Reporting that something works
  - Before writing a number into a commit message
---

# Measure rather than reason

**If a claim can be checked by running something, run it.** Reasoning about how a
tool ought to behave is a way of generating hypotheses, not evidence, and this
repository has a runner, a flow harness and 20-odd servers that can be started in
a second.

## What it has changed

Twice in one day, a conclusion reversed on contact with a measurement.

**CI was assumed to be CPU-bound across packages.** `pnpm -r test` turned out to
already run them concurrently: the same commit took 133s on 22 cores locally and
145s on CI's two to four. Total CPU was not the constraint, one machine's worth of
it was, and the fix was runners rather than concurrency. Three rounds of measuring
took the run from 207s to 106s, and each round moved the bottleneck somewhere the
previous reasoning had not predicted.

**A discriminated union looked like the answer to publishing one schema for
sixteen actions.** It validates correctly and publishes an empty object, because
the SDK's conversion to JSON Schema does not handle unions and returns nothing
rather than failing. An hour of design would not have found that; one probe did.

## Rules

- **Drive the real thing.** For an MCP server that means starting it and calling
  it, not reading its source. Registration paths differ enough that grep gave three
  different answers to "which servers have a `describe` tool"; starting them gave
  one.
- **A number in a commit message was measured.** If it was taken from a review, a
  memory or an estimate, it does not go in.
- **Report what the run said,** including when it contradicts what was expected.
  A retraction costs one paragraph; a confident wrong number costs whoever relies
  on it.
- **Mutate the check.** A test that passes proves nothing until it has been seen to
  fail — see `coding-rules__test-coverage`.
