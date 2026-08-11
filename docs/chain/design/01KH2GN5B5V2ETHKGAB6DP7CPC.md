---
id: 01KH2GN5B5V2ETHKGAB6DP7CPC
type: design
requires: 01KH2GJESZJQEB4FENZCM0PQ86
title: grep操作実装設計
created: 2026-02-10T00:54:07.461Z
updated: 2026-02-10T05:29:46.172Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/operations/grep.ts`

  ## 操作定義

  ```typescript
  export const grepOperation: Operation = {
    id: "grep",
    category: "Search",
    summary: "コード検索（正規表現対応）",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      pattern: z.string(),
      path: z.string().optional(),
      ref: z.string().default("HEAD"),
      context: z.number().optional(),
      ignore_case: z.boolean().optional(),
    }),
    async execute(args, ctx) {
      const cmd = ["grep", "-n"];
      if (args.ignore_case) cmd.push("-i");
      if (args.context) cmd.push(`-C${args.context}`);
      cmd.push(args.pattern, args.ref);
      if (args.path) cmd.push("--", args.path);
      
      const result = await execGit(cmd, ctx.repoPath);
      return { content: [{ type: "text", text: result }] };
    }
  };
  ```
filePath: docs/chain/design/01KH2GN5B5V2ETHKGAB6DP7CPC.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/grep.ts`

## 操作定義

```typescript
export const grepOperation: Operation = {
  id: "grep",
  category: "Search",
  summary: "コード検索（正規表現対応）",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    pattern: z.string(),
    path: z.string().optional(),
    ref: z.string().default("HEAD"),
    context: z.number().optional(),
    ignore_case: z.boolean().optional(),
  }),
  async execute(args, ctx) {
    const cmd = ["grep", "-n"];
    if (args.ignore_case) cmd.push("-i");
    if (args.context) cmd.push(`-C${args.context}`);
    cmd.push(args.pattern, args.ref);
    if (args.path) cmd.push("--", args.path);
    
    const result = await execGit(cmd, ctx.repoPath);
    return { content: [{ type: "text", text: result }] };
  }
};
```
