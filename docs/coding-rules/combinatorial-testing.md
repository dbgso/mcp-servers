---
description: When a tool's inputs multiply out faster than anyone will enumerate them, generate the combinations with PICT and assert a property over them.
whenToUse:
  - Testing a tool with several independent optional arguments
  - Testing a state machine crossed with its arguments
  - Deciding whether hand-written cases are enough
  - Regenerating a committed case list after changing a model
---

# Combinatorial Testing

Hand-written cases say what someone thought of. When a tool's inputs multiply
out past what anyone will enumerate, that gap is unmeasured. `approve` is five
states crossed with four optional arguments -- 160 combinations -- and its
tests covered the paths that had been reported.

Generate the combinations instead, and assert the property the code exists to
hold.

## The shape

```
src/__tests__/models/
├── <tool>.pict         # the model: factors, values, constraints
├── <tool>.seed.tsv     # rows the generator must include
└── <tool>.cases.tsv    # the generated output, committed
```

The test reads the committed `.cases.tsv`. PICT is **not** a dependency: its npm
wrapper clones and compiles the tool on every install, which puts a network and
a compiler in the way of `pnpm install`. Committing the output keeps CI
hermetic, and makes a model change visible as a diff in the case list.

Regenerating needs the binary, and only when the model changes:

```bash
git clone --branch v3.7.4 --depth 1 https://github.com/microsoft/pict
make -C pict
./pict/pict src/__tests__/models/approve.pict /o:2 \
  /e:src/__tests__/models/approve.seed.tsv \
  > src/__tests__/models/approve.cases.tsv
```

## Assert a property, not a row

A generated suite cannot carry an expected output per row without restating the
logic under test, and a test that restates the code only tests the restatement.
Assert what the code is for:

```typescript
// approve: a document reaches the corpus only if its draft was on disk, the
// workflow recorded a review, the caller explained it, and the caller repeated
// the identical call past the deliberation gate.
expect(promoted.sort()).toEqual(cases.filter(shouldPromote).sort());
```

Both directions. Promoting without the conditions is a hole in the gate;
refusing despite them is a document stuck outside the corpus.

## Check that the suite can fail

A generated suite that passes whatever the code does is theatre. Break the
thing it guards and watch it go red:

| mutation | caught |
|---|---|
| remove the batch `explanation` guard | yes -- a third row promoted |
| gate 2 attempts -> 1 | only after seeding |

That second row is why `approve.seed.tsv` exists. Pairwise generation covers
every *pair*, which is not the same as covering the boundary: no generated row
happened to meet every promotion condition except the repeat, so weakening the
gate passed unnoticed. Seed the boundary rows the property turns on.

## When not to bother

Few factors, or most combinations meaningless. `read` is two states and one
argument; its cases are worth writing by hand and reading.
