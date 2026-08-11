---
id: 01KH2GN6HS1MBXD8QF6Q0XZTA0
type: design
requires: 01KH2GJGAQKJEZJ4HD9FA6137H
title: log操作実装設計
created: 2026-02-10T00:54:08.697Z
updated: 2026-02-10T05:29:46.765Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/operations/log.ts`

  ## 操作定義

  ```typescript
  export const logOperation: Operation = {
    id: "log",
    category: "History",
    summary: "コミット履歴",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      ref: z.string().default("HEAD"),
      path: z.string().optional(),
      limit: z.number().default(20),
      since: z.string().optional(),
      author: z.string().optional(),
    }),
    async execute(args, ctx) {
      const format = "%H|%an|%ae|%at|%s";
      const cmd = ["log", `--format=${format}`, `-n${args.limit}`];
      if (args.since) cmd.push(`--since=${args.since}`);
      if (args.author) cmd.push(`--author=${args.author}`);
      cmd.push(args.ref);
      if (args.path) cmd.push("--", args.path);
      
      const result = await execGit(cmd, ctx.repoPath);
      const commits = parseLogOutput(result);
      return {
        content: [{ type: "text", text: JSON.stringify(commits, null, 2) }]
      };
    }
  };
  ```
filePath: docs/chain/design/01KH2GN6HS1MBXD8QF6Q0XZTA0.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/log.ts`

## 操作定義

```typescript
export const logOperation: Operation = {
  id: "log",
  category: "History",
  summary: "コミット履歴",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    ref: z.string().default("HEAD"),
    path: z.string().optional(),
    limit: z.number().default(20),
    since: z.string().optional(),
    author: z.string().optional(),
  }),
  async execute(args, ctx) {
    const format = "%H|%an|%ae|%at|%s";
    const cmd = ["log", `--format=${format}`, `-n${args.limit}`];
    if (args.since) cmd.push(`--since=${args.since}`);
    if (args.author) cmd.push(`--author=${args.author}`);
    cmd.push(args.ref);
    if (args.path) cmd.push("--", args.path);
    
    const result = await execGit(cmd, ctx.repoPath);
    const commits = parseLogOutput(result);
    return {
      content: [{ type: "text", text: JSON.stringify(commits, null, 2) }]
    };
  }
};
```
