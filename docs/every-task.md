---
description: Essential checklist to review before starting any task, including required tools, principles, and coding rules.
whenToUse:
  - Starting any new task
  - Checking required tools and workflows before implementation
  - Finding project coding rules and documentation references
---

# Every Task Checklist

Essential information to check before starting any task.

## Required Tools

- **Plan Tool**: All implementation work must use the `plan` tool. See `workflow__plan-tool-required` for details.
  - Check current plan: `plan(action: "show")`
  - Start task: `plan(action: "status", id: "...", status: "in_progress")`

## Reporting

- **Verification Reporting**: See `workflow__verification-reporting`

## Principles

- **DRY**: See `workflow__dry-principle`
- **AST Tool Evolution**: See `workflow__ast-tool-evolution` - 開発中に便利なツールを見つけたらast-*-mcpに追加

## Coding Rules

Check `coding-rules/` for project-specific coding standards before writing code.

## Documentation

Use `help` tool to find relevant documentation before starting work.
