---
id: 01KH2GN4WY8QT9V5S1SX71RT8Z
type: design
requires: 01KH2GJEBPKMDKM6RY8RXJNA16
title: git_execute実装設計
created: 2026-02-10T00:54:07.006Z
updated: 2026-02-10T05:29:45.972Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/server.ts`

  ## ハンドラ実装

  ```typescript
  if (name === "git_execute") {
    const { operation, params } = ExecuteSchema.parse(args);
    
    const op = getOperation(operation);
    if (!op) {
      return errorResponse(`Unknown operation: ${operation}`);
    }
    
    // Zodスキーマで検証
    const parseResult = op.argsSchema.safeParse(params);
    if (!parseResult.success) {
      return errorResponse(formatZodError(parseResult.error));
    }
    
    // リポジトリ解決
    const repoPath = await resolver.resolve(parseResult.data.repo_url);
    
    // 操作実行
    return op.execute(parseResult.data, { repoPath });
  }
  ```

  ## エラーハンドリング

  全エラーを`isError: true`でラップ
filePath: docs/chain/design/01KH2GN4WY8QT9V5S1SX71RT8Z.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/server.ts`

## ハンドラ実装

```typescript
if (name === "git_execute") {
  const { operation, params } = ExecuteSchema.parse(args);
  
  const op = getOperation(operation);
  if (!op) {
    return errorResponse(`Unknown operation: ${operation}`);
  }
  
  // Zodスキーマで検証
  const parseResult = op.argsSchema.safeParse(params);
  if (!parseResult.success) {
    return errorResponse(formatZodError(parseResult.error));
  }
  
  // リポジトリ解決
  const repoPath = await resolver.resolve(parseResult.data.repo_url);
  
  // 操作実行
  return op.execute(parseResult.data, { repoPath });
}
```

## エラーハンドリング

全エラーを`isError: true`でラップ
