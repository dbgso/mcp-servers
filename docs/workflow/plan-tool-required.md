# Plan Tool Required

All implementation work must use the plan tool for task tracking and progress visibility.

## Rule

All implementation work MUST use the `plan` tool to track progress.

## Why

- Ensures structured task management
- Provides visibility into work progress
- Enforces completion criteria and review workflow
- Records changes and reasoning for each task

## How

1. Before starting work, check the plan: `plan(action: "show")`
2. Start a task: `plan(action: "status", id: "task-id", status: "in_progress")`
3. Complete with required fields: `plan(action: "status", id: "task-id", status: "completed", changes: [...], why: "...", references_used: [...], references_reason: "...")`

## Workflow

```
pending → in_progress → completed → pending_review → approved
```

Tasks cannot skip `in_progress`. Completion requires structured reporting.