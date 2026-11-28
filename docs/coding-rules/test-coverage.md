---
whenToUse:
  - Writing tests
  - Checking coverage requirements
  - Preparing code for PR review
  - Configuring test coverage exclusions
---

# Test Coverage Requirements

All code must maintain a minimum test coverage of 95%.

## Required Coverage

| Metric | Minimum |
|--------|---------|
| Statements | 95% |
| Branches | 95% |
| Functions | 95% |
| Lines | 95% |

## How to Check

```bash
pnpm test --coverage
```

Not `pnpm test -- --coverage`. The `--` hands what follows to vitest as a
test-name filter, so `--coverage` is read as a filter and dropped: the tests
run, no coverage is measured, and the thresholds below are never checked. CI
carried that form from its first commit, which is why a package could sit
seven points under its own threshold with a green build.

## What is measured

```typescript
coverage: {
  include: ["src/**/*.ts"],
}
```

Without an explicit `include`, v8 counts only the files a test imported. A file
with no test at all does not appear in the total, so the figure describes the
tested part of the package and says nothing about the rest. Several packages
here reported a number that looked finished while their server entry point --
the file every tool call goes through -- was never loaded: `cli-to-mcp` read
100% on four files and 59% on all of them.

The same applies to an integration test that spawns the built server as a child
process. It exercises the code, but v8 is not in that process, so none of it is
measured; `mcp-firewall` and `ast-file-mcp` both had suites like that over code
reporting 0%.

## CI Enforcement

Coverage is checked in CI. PRs that drop coverage below 95% will fail.

## Exceptions

If coverage cannot be achieved for specific files (e.g., entry points, CLI scripts), they should be excluded in `vitest.config.ts`:

```typescript
coverage: {
  exclude: ["src/index.ts", "src/cli.ts"],
}
```

## Why

- Ensures code quality and reliability
- Catches regressions early
- Documents expected behavior through tests
