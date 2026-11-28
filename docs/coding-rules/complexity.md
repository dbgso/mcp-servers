---
description: What to do about a function with too many branches, by the kind of branching -- dispatch, repeated question, mixed steps, guards, defaults, inherent algorithm -- and which of those lint reports.
whenToUse:
  - A function is reported by eslint(complexity)
  - A function is reported by custom/no-discriminant-chain or custom/no-repeated-comparison
  - Writing a function with an if/else-if chain or switch
  - Deciding whether to split a function or leave it
  - Reviewing a refactor that only lowers the complexity number
relatedDocs:
  - coding-rules__polymorphism
  - coding-rules__early-return
  - coding-rules__ternary-testability
approvedAt: 2026-10-04T07:43:52.616Z
---

# Branching and complexity

**The aim is code each of whose paths can be tested on its own -- not a lower
number.** `eslint(complexity)` counts branches; it cannot tell a dispatch that
should be a type from a defaulted field that is fine as it is. Read the branches,
name what kind they are, and do what that kind calls for. Some kinds call for
nothing.

## Kinds of branching

| Kind | Looks like | Do | Lint |
|---|---|---|---|
| Dispatch on a kind | `if (x.type === "a") … else if (x.type === "b") …`, `switch (kind)` | A `Record` keyed by the discriminator: data per kind when the arms differ only in values, a class per kind behind one interface when they differ in behaviour (`coding-rules__polymorphism`) | `custom/no-discriminant-chain` |
| Mapping | every arm only returns a value | A `Record` constant | `custom/no-discriminant-chain` |
| The same question, once per candidate | `k === "a" \|\| k === "b" \|\| k === "c"`, `a === undefined && b === undefined && …`, `url.startsWith("http://") \|\| url.startsWith("https://")` | One named list and a named predicate: `KINDS.has(k)`, `FIELDS.every(…)` | `custom/no-repeated-comparison` |
| Mixed responsibilities | one function validates, builds, writes and formats | One pure function per step (`coding-rules__general`) | `eslint(complexity)` only |
| Guard sequence | `if (bad) return error` repeated, each testing something different | Early returns are already right (`coding-rules__early-return`). Extract a guard only when the same guards repeat across functions | none |
| Defaulting | `?? x`, `\|\| ""`, `if (v) out.k = v` | Absorb it where a schema can (zod `.default()`). Otherwise leave it: each branch is trivial and already covered | none |
| Inherent algorithm | tokenizer state machine, a walk that mirrors the data's shape, a cycle check | Leave it | none |

The first three are the ones that hurt: each kind or candidate is a path, and a
path you can only reach by building the whole input is a path nobody tests. The
last two only inflate the count. Rewriting them to satisfy the counter -- moving
`??` into a `pickDefined` helper, splitting a state machine across functions --
hides the branches from the metric without making anything easier to test.

## Duplication is the bigger finding

Most dispatches and repeated questions turned out to be **written more than once**,
and copies drift. `read_output` in interactive-pdca-mcp switched on phase names
(`research`, `implement`, …) that production no longer writes (`plan`, `do`,
`check`, `act`), so it never printed a phase section -- and its tests passed,
because they used the old names too. `getStatusIcon` exists in two files that no
longer agree. A `Record<TaskPhase, …>` keyed by a union type would have made the
first a compile error.

So before reducing a chain, look for its twin. One table, one predicate, one
class per kind -- shared -- is the fix; two tidier copies are not.

Lint cannot see duplication across files. That is checked by reading, not by a
rule.

## Lint

- `custom/no-discriminant-chain` and `custom/no-repeated-comparison` report the
  first three kinds, with the reason and this document in the message.
- `eslint(complexity)` stays a warning at 3: a signal to read the function and
  classify it, not a gate. The threshold it is raised to as an error is decided
  once the dispatches and repeated questions are gone, at the level where only
  the kinds this document says to leave remain.
- Test files are not checked by the two custom rules.
