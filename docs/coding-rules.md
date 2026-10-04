---
description: "The index of the coding rules: one line per rule, with the rule itself in its own document."
whenToUse:
  - Looking for the coding rule that covers something
  - Adding a new coding rule and needing where it goes
  - Onboarding onto this project's coding standards
relatedDocs:
  - coding-rules__general
  - coding-rules__style
  - coding-rules__english-comments
  - coding-rules__if-statement-comments
  - coding-rules__typescript
  - coding-rules__early-return
  - coding-rules__polymorphism
  - coding-rules__ternary-testability
  - coding-rules__mcp-tool-design
  - coding-rules__mcp-tool-approval
  - coding-rules__mcp-tool-testing
  - coding-rules__handler-pattern
  - coding-rules__schema-sync
  - coding-rules__test-coverage
  - coding-rules__test-fixtures
  - coding-rules__combinatorial-testing
  - coding-rules__prefer-git-mcp
---

# Coding Standards

The index of this project's coding rules. One line each -- the rule itself is in
the document, and a second account of it here would disagree with it the first
time either is edited.

## Code style

- `coding-rules__general` — the fundamentals: DRY, naming, what makes code maintainable.
- `coding-rules__style` — keep code DRY by extracting and sharing common logic.
- `coding-rules__english-comments` — all comments in English.
- `coding-rules__if-statement-comments` — a summary comment above each `if`, unless the condition is self-evident.
- `coding-rules__typescript` — TypeScript specifics, Zod among them.

## Control flow

- `coding-rules__complexity` — what to do with a branchy function, by the kind of branching; which kinds lint reports.
- `coding-rules__early-return` — return early rather than carrying a `let` or a ternary.
- `coding-rules__polymorphism` — polymorphism instead of `if`/`switch`; interfaces implemented by classes.
- `coding-rules__ternary-testability` — a ternary is hard to cover; extract it to a function.

## MCP tools

- `coding-rules__mcp-tool-design` — describe + execute as the basic shape.
- `coding-rules__mcp-tool-approval` — approval is granted per tool, not per action.
- `coding-rules__mcp-tool-testing` — the process for creating or changing a tool.
- `coding-rules__handler-pattern` — instance-based handlers for action routing.
- `coding-rules__schema-sync` — keeping schemas in step under the handler pattern.

## Tests

- `coding-rules__test-coverage` — 95% minimum.
- `coding-rules__test-fixtures` — fixtures live in the repository; tests never reach for external files.
- `coding-rules__combinatorial-testing` — generate the combinations with PICT and assert a property over them.

## Tooling

- `coding-rules__prefer-git-mcp` — read-only git goes through `git-repo-explorer-mcp`.

## Adding a rule

Write the document under this family's id, then add its line above.
`stale-hub-index` reports the second step when it is forgotten, which is the only
reason this list can be trusted.
