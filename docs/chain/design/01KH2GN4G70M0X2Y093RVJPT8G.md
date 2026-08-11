---
id: 01KH2GN4G70M0X2Y093RVJPT8G
type: design
requires: 01KH2GJDS4F0K5YEMVBN2WA1SE
title: git_describe実装設計
created: 2026-02-10T00:54:06.600Z
updated: 2026-02-10T05:29:45.725Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/server.ts`

  ## ハンドラ実装

  ```typescript
  if (name === "git_describe") {
    const { operation } = args;
    
    if (operation) {
      // 特定操作の詳細を返す
      const op = getOperation(operation);
      if (!op) return errorResponse(`Unknown operation: ${operation}`);
      
      return {
        content: [{
          type: "text",
          text: formatOperationDetail(op)
        }]
      };
    }
    
    // 全操作一覧を返す
    return {
      content: [{
        type: "text",
        text: formatOperationList(allOperations)
      }]
    };
  }
  ```

  ## 操作レジストリ

  `operations/registry.ts`で全操作を管理
filePath: docs/chain/design/01KH2GN4G70M0X2Y093RVJPT8G.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/server.ts`

## ハンドラ実装

```typescript
if (name === "git_describe") {
  const { operation } = args;
  
  if (operation) {
    // 特定操作の詳細を返す
    const op = getOperation(operation);
    if (!op) return errorResponse(`Unknown operation: ${operation}`);
    
    return {
      content: [{
        type: "text",
        text: formatOperationDetail(op)
      }]
    };
  }
  
  // 全操作一覧を返す
  return {
    content: [{
      type: "text",
      text: formatOperationList(allOperations)
    }]
  };
}
```

## 操作レジストリ

`operations/registry.ts`で全操作を管理
