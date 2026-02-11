---
id: 01KH2GN65GGGM7458ARBMVWW5J
type: design
requires: 01KH2GJFTJ1YDVGBCKPWY9D7S5
title: show操作実装設計
created: 2026-02-10T00:54:08.304Z
updated: 2026-02-10T05:29:46.607Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/operations/show.ts`

  ## 操作定義

  ```typescript
  export const showOperation: Operation = {
    id: "show",
    category: "File",
    summary: "ファイル/コミット表示",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      ref: z.string(),
      path: z.string().optional(),
    }),
    async execute(args, ctx) {
      if (args.path) {
        // ファイル内容
        const content = await execGit(
          ["show", `${args.ref}:${args.path}`],
          ctx.repoPath
        );
        return { content: [{ type: "text", text: content }] };
      }
      
      // コミット詳細
      const result = await execGit(
        ["show", "--stat", args.ref],
        ctx.repoPath
      );
      return { content: [{ type: "text", text: result }] };
    }
  };
  ```
filePath: docs/chain/design/01KH2GN65GGGM7458ARBMVWW5J.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/show.ts`

## 操作定義

```typescript
export const showOperation: Operation = {
  id: "show",
  category: "File",
  summary: "ファイル/コミット表示",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    ref: z.string(),
    path: z.string().optional(),
  }),
  async execute(args, ctx) {
    if (args.path) {
      // ファイル内容
      const content = await execGit(
        ["show", `${args.ref}:${args.path}`],
        ctx.repoPath
      );
      return { content: [{ type: "text", text: content }] };
    }
    
    // コミット詳細
    const result = await execGit(
      ["show", "--stat", args.ref],
      ctx.repoPath
    );
    return { content: [{ type: "text", text: result }] };
  }
};
```
