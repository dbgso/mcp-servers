# English Comments

All code comments must be written in English.

## Applies to

- Inline comments (`//`)
- Block comments (`/* */`)
- JSDoc comments (`/** */`)
- TODO/FIXME comments

## Examples

```typescript
// ✅ Good
// Guard: Task must exist in the plan
if (!task) { ... }

// ❌ Bad
// タスクが存在しない場合はエラー
if (!task) { ... }
```

## Why

- Consistency across the codebase
- Accessible to international contributors
- Standard practice in open source projects
