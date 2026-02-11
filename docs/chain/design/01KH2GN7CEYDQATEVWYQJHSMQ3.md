---
id: 01KH2GN7CEYDQATEVWYQJHSMQ3
type: design
requires: 01KH2GJHBNYED2GZV2G4SYSN79
title: diff操作実装設計
created: 2026-02-10T00:54:09.550Z
updated: 2026-02-10T05:29:47.157Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/operations/diff.ts`

  ## 操作定義

  ```typescript
  export const diffOperation: Operation = {
    id: "diff",
    category: "History",
    summary: "2つのref間の差分",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      from_ref: z.string(),
      to_ref: z.string().default("HEAD"),
      path: z.string().optional(),
      stat_only: z.boolean().optional(),
    }),
    async execute(args, ctx) {
      const cmd = ["diff"];
      if (args.stat_only) cmd.push("--stat");
      cmd.push(`${args.from_ref}..${args.to_ref}`);
      if (args.path) cmd.push("--", args.path);
      
      const result = await execGit(cmd, ctx.repoPath);
      return { content: [{ type: "text", text: result }] };
    }
  };
  ```
filePath: docs/chain/design/01KH2GN7CEYDQATEVWYQJHSMQ3.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/diff.ts`

## 操作定義

```typescript
export const diffOperation: Operation = {
  id: "diff",
  category: "History",
  summary: "2つのref間の差分",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    from_ref: z.string(),
    to_ref: z.string().default("HEAD"),
    path: z.string().optional(),
    stat_only: z.boolean().optional(),
  }),
  async execute(args, ctx) {
    const cmd = ["diff"];
    if (args.stat_only) cmd.push("--stat");
    cmd.push(`${args.from_ref}..${args.to_ref}`);
    if (args.path) cmd.push("--", args.path);
    
    const result = await execGit(cmd, ctx.repoPath);
    return { content: [{ type: "text", text: result }] };
  }
};
```
