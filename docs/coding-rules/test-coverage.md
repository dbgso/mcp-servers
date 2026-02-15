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
pnpm test -- --coverage
```

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
