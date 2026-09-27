---
description: Prefer a lint rule over a written one, and how this repository's custom rules are built
whenToUse:
  - deciding whether a convention should be a lint rule
  - adding a custom rule
  - finding which custom rules exist
---

# Lint Rule Management

Prefer a lint rule over a written one.

## A rule that can be checked should be checked

A convention that lives only in a document is a convention that is followed
until someone is in a hurry. If a rule can be expressed as a lint rule, it
belongs in the linter -- including as a custom rule when no published one fits.

This repository lints with **oxlint** (`.oxlintrc.json`), and its own rules live
in `eslint-rules/`, loaded through `jsPlugins`:

| Rule | What it catches |
|------|-----------------|
| `custom/single-params-object` | More than one positional parameter |
| `custom/implement-interface-with-class` | An interface implemented as an object literal |
| `custom/no-branching-literal` | A conditional whose branches are multi-line literals |

Alongside them, `complexity` warns at more than three branches in one function:
a signal to extract, not a hard limit.

## Writing one

A rule is a file in `eslint-rules/` exporting `meta` and `create`, registered in
`eslint-rules/index.js` and enabled in `.oxlintrc.json`. The doc comment is the
place to say which real defect prompted it -- a rule whose reason is forgotten is
the next rule someone disables.

## When a rule cannot be written

Say so in the document that states the convention, and say why. "This is not
checkable" is useful to the next reader; silence reads as "nobody tried".
