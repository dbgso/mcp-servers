---
description: Guidelines for writing tests when fixing bugs to prevent regressions
whenToUse:
  - Fixing bugs or defects in the codebase
  - Writing tests for bug fixes
  - Ensuring regressions are prevented
---

# Bug Fix Testing Rule

発見した不具合を修正する際は、必ずテストコードで担保する。

## ルール

1. **修正前にテストを書く** - 不具合を再現するテストを先に書く
2. **テストが失敗することを確認** - 修正前はテストが失敗すること
3. **修正を実装** - 不具合を修正
4. **テストが成功することを確認** - 修正後はテストが成功すること

## 理由

- 同じ不具合の再発を防ぐ
- 修正が正しいことを証明する
- リグレッションテストとして機能する

## 例

```typescript
// 不具合: notesなしでself_review→pending_explanationが成功してしまう
it("should fail without notes", async () => {
  const result = await instance.trigger({
    params: { action: "review_complete" },  // notesなし
  });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("notes");
});
```
