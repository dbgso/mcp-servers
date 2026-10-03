---
description: How the work is done here, as opposed to what it has to come out as. The index of the working rules.
whenToUse:
  - Starting work and wanting to know which rules apply to how it is done
  - Deciding where a new working rule belongs
  - Looking for the rule about plans, reporting, or how to constrain a mistake
relatedDocs:
  - workflow__plan-tool-required
  - workflow__verification-reporting
  - workflow__constraint-ladder
  - workflow__measure-dont-assume
  - workflow__skill-as-trigger
  - workflow__edit-docs-through-the-tool
  - workflow__dry-principle
  - workflow__ast-tool-evolution
---

# Workflow

How the work is done. `policy` is what a server has to come out as, and
`coding-rules` is how the code inside it is written; this is the conduct of the
work itself.

A rule added here is reachable from `every-task` through this document, which is
the point of the document: `every-task` names this hub, not each rule, so adding a
rule is one file rather than two and the two cannot come to disagree about what
exists.

## Doing the work

- `workflow__plan-tool-required` — implementation work goes through the `plan` tool.
- `workflow__verification-reporting` — what a report of "it works" has to contain.

## Deciding how

- `workflow__constraint-ladder` — a mistake worth preventing gets the highest rung
  that can express it: type, lint, custom lint, test, then a rule in a document.
- `workflow__measure-dont-assume` — where a claim can be checked by running
  something, run it.
- `workflow__skill-as-trigger` — a skill fires; the rule it fires lives in a
  document, and the skill's body is the one line that names it.
- `workflow__edit-docs-through-the-tool` — a document in a managed corpus is
  changed with that server's actions, because the frontmatter is YAML and the
  write is checked.

## Keeping the tools worth using

- `workflow__dry-principle`
- `workflow__ast-tool-evolution` — a tool wanted during development gets added to
  `ast-*-mcp` while the want is fresh.
