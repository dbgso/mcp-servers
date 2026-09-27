---
description: Essential checklist to review before starting any task, including required tools, principles, and coding rules.
whenToUse:
  - Starting any new task
  - Checking required tools and workflows before implementation
  - Finding project coding rules and documentation references
relatedDocs:
  - policy
  - workflow__measure-dont-assume
---

# Every Task Checklist

Essential information to check before starting any task.

## Required Tools

- **Plan Tool**: All implementation work must use the `plan` tool. See `workflow__plan-tool-required` for details.
  - Check current plan: `plan(action: "show")`
  - Start task: `plan(action: "status", id: "...", status: "in_progress")`

## Reporting

- **Verification Reporting**: See `workflow__verification-reporting`

## Policy

`policy` is what a server has to be, as opposed to how it is written. A server
that diverges from one of those documents is defective rather than different, and
each of them carries the list of what currently does not conform.

Read it before adding a tool, choosing a gate for a mutation, or introducing a
rule.

## Principles

- **DRY**: See `workflow__dry-principle`
- **AST Tool Evolution**: See `workflow__ast-tool-evolution` - When you discover useful tools during development, add them to ast-*-mcp
- **Measure rather than reason**: See `workflow__measure-dont-assume` - where a claim can be checked by running something, run it

## Coding Rules

Check `coding-rules/` for project-specific coding standards before writing code.

## Documentation

Call `describe()` for what a server's tools take, and
`instruction(action: "list", recursive: true)` to find the documents, before
starting work. (`help` was the 1.x name and no longer exists.)
