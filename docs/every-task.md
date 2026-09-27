---
description: Essential checklist to review before starting any task, including required tools, principles, and coding rules.
whenToUse:
  - Starting any new task
  - Checking required tools and workflows before implementation
  - Finding project coding rules and documentation references
relatedDocs:
  - policy
  - workflow
---

# Every Task Checklist

Essential information to check before starting any task.

## Required Tools

- **Plan Tool**: All implementation work must use the `plan` tool.
  - Check current plan: `plan(action: "show")`
  - Start task: `plan(action: "status", id: "...", status: "in_progress")`

## Policy

`policy` is what a server has to be, as opposed to how it is written. A server
that diverges from one of those documents is defective rather than different, and
each of them carries the list of what currently does not conform.

Read it before adding a tool, choosing a gate for a mutation, or introducing a
rule.

## How the work is done

`workflow` is the index of the working rules -- plans, reporting, how to constrain
a mistake, when to measure rather than reason, what a skill is for. Read it rather
than a list repeated here: this file naming each rule is how the list and the
directory come to disagree about what exists.

## Coding Rules

Check `coding-rules/` for project-specific coding standards before writing code.

## Documentation

Call `describe()` for what a server's tools take, and
`instruction(action: "list", recursive: true)` to find the documents, before
starting work. (`help` was the 1.x name and no longer exists.)
