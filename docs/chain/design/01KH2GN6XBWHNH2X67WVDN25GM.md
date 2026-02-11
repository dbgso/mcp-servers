---
id: 01KH2GN6XBWHNH2X67WVDN25GM
type: design
requires: 01KH2GJGTZ4N5G93AFXCSKBD7Q
title: blame操作実装設計
created: 2026-02-10T00:54:09.067Z
updated: 2026-02-10T05:29:46.959Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/operations/blame.ts`

  ## 操作定義

  ```typescript
  export const blameOperation: Operation = {
    id: "blame",
    category: "History",
    summary: "行ごとの変更者",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      path: z.string(),
      ref: z.string().default("HEAD"),
      start_line: z.number().optional(),
      end_line: z.number().optional(),
    }),
    async execute(args, ctx) {
      const cmd = ["blame", "--porcelain"];
      if (args.start_line && args.end_line) {
        cmd.push(`-L${args.start_line},${args.end_line}`);
      }
      cmd.push(args.ref, "--", args.path);
      
      const result = await execGit(cmd, ctx.repoPath);
      const lines = parseBlameOutput(result);
      return {
        content: [{ type: "text", text: JSON.stringify(lines, null, 2) }]
      };
    }
  };
  ```

  ## パーサー

  porcelain形式を構造化したオブジェクトに変換
filePath: docs/chain/design/01KH2GN6XBWHNH2X67WVDN25GM.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/blame.ts`

## 操作定義

```typescript
export const blameOperation: Operation = {
  id: "blame",
  category: "History",
  summary: "行ごとの変更者",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    path: z.string(),
    ref: z.string().default("HEAD"),
    start_line: z.number().optional(),
    end_line: z.number().optional(),
  }),
  async execute(args, ctx) {
    const cmd = ["blame", "--porcelain"];
    if (args.start_line && args.end_line) {
      cmd.push(`-L${args.start_line},${args.end_line}`);
    }
    cmd.push(args.ref, "--", args.path);
    
    const result = await execGit(cmd, ctx.repoPath);
    const lines = parseBlameOutput(result);
    return {
      content: [{ type: "text", text: JSON.stringify(lines, null, 2) }]
    };
  }
};
```

## パーサー

porcelain形式を構造化したオブジェクトに変換
