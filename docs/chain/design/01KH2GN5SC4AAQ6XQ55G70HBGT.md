---
id: 01KH2GN5SC4AAQ6XQ55G70HBGT
type: design
requires: 01KH2GJFC2Z3WFFHHM40W1K450
title: ls_files操作実装設計
created: 2026-02-10T00:54:07.916Z
updated: 2026-02-10T05:29:46.355Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/operations/ls-files.ts`

  ## 操作定義

  ```typescript
  export const lsFilesOperation: Operation = {
    id: "ls_files",
    category: "File",
    summary: "ファイル一覧",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      ref: z.string().default("HEAD"),
      path: z.string().optional(),
      recursive: z.boolean().default(true),
    }),
    async execute(args, ctx) {
      const cmd = ["ls-tree", "--long"];
      if (args.recursive) cmd.push("-r");
      cmd.push(args.ref);
      if (args.path) cmd.push(args.path);
      
      const result = await execGit(cmd, ctx.repoPath);
      const files = parseLsTree(result);
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }]
      };
    }
  };
  ```

  ## パーサー

  ls-tree出力をJSONに変換
filePath: docs/chain/design/01KH2GN5SC4AAQ6XQ55G70HBGT.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/ls-files.ts`

## 操作定義

```typescript
export const lsFilesOperation: Operation = {
  id: "ls_files",
  category: "File",
  summary: "ファイル一覧",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    ref: z.string().default("HEAD"),
    path: z.string().optional(),
    recursive: z.boolean().default(true),
  }),
  async execute(args, ctx) {
    const cmd = ["ls-tree", "--long"];
    if (args.recursive) cmd.push("-r");
    cmd.push(args.ref);
    if (args.path) cmd.push(args.path);
    
    const result = await execGit(cmd, ctx.repoPath);
    const files = parseLsTree(result);
    return {
      content: [{ type: "text", text: JSON.stringify(files, null, 2) }]
    };
  }
};
```

## パーサー

ls-tree出力をJSONに変換
