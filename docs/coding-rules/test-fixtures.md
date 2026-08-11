---
whenToUse:
  - Writing Vitest tests
  - Creating test data files
  - Refactoring tests with external dependencies
  - Setting up test fixtures directory
---

# Test Fixtures

Vitest tests must use fixture files, not external file references.

## Principle

Vitest tests must NOT reference external files directly. Instead, create fixture files that replicate the same structure.

## Why

1. **Reproducibility** - Tests run consistently regardless of external file changes
2. **Isolation** - Tests don't depend on user's local environment
3. **CI/CD** - Tests work in any environment without setup
4. **Documentation** - Fixtures serve as examples of supported formats

## How

1. Identify the structure/pattern to test from external files
2. Create minimal fixture files in `src/__tests__/fixtures/`
3. Use fixtures in vitest tests instead of external paths

## Example

```typescript
// Bad: References external file
const result = await handler.read("/home/user/docs/example.adoc");

// Good: Uses fixture
const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const result = await handler.read(join(FIXTURES_DIR, "antora-style.adoc"));
```

## Fixture Naming

- `{format}-{feature}.{ext}` - e.g., `antora-xref.adoc`, `markdown-gfm.md`
- Keep fixtures minimal - only include what's needed for the test
