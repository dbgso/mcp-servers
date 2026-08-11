---
id: 01KH2GN8DC31MPJHN6Q39RY1CF
type: design
requires: 01KH2GJJD4MRGFZC1C63SWPQ8K
title: tag_list操作実装設計
created: 2026-02-10T00:54:10.604Z
updated: 2026-02-10T05:29:47.637Z
content: >-
  ## 実装ファイル


  `packages/mcp-git-repo-explorer/src/operations/tag.ts`


  ## 操作定義


  ```typescript

  export const tagListOperation: Operation = {
    id: "tag_list",
    category: "Reference",
    summary: "タグ一覧",
    argsSchema: z.object({
      repo_url: z.string().optional(),
      pattern: z.string().optional(),
      sort: z.enum(["version", "date"]).default("version"),
    }),
    async execute(args, ctx) {
      const format = "%(refname:short)|%(objectname:short)|%(creatordate:iso8601)|%(subject)";
      const sortFlag = args.sort === "version" 
        ? "--sort=-version:refname" 
        : "--sort=-creatordate";
      
      const cmd = ["tag", "-l", `--format=${format}`, sortFlag];
      if (args.pattern) cmd.push(args.pattern);
      
      const result = await execGit(cmd, ctx.repoPath);
      const tags = parseTagOutput(result);
      
      return {
        content: [{ type: "text", text: JSON.stringify(tags, null, 2) }]
      };
    }
  };

  ```
filePath: docs/chain/design/01KH2GN8DC31MPJHN6Q39RY1CF.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/operations/tag.ts`

## 操作定義

```typescript
export const tagListOperation: Operation = {
  id: "tag_list",
  category: "Reference",
  summary: "タグ一覧",
  argsSchema: z.object({
    repo_url: z.string().optional(),
    pattern: z.string().optional(),
    sort: z.enum(["version", "date"]).default("version"),
  }),
  async execute(args, ctx) {
    const format = "%(refname:short)|%(objectname:short)|%(creatordate:iso8601)|%(subject)";
    const sortFlag = args.sort === "version" 
      ? "--sort=-version:refname" 
      : "--sort=-creatordate";
    
    const cmd = ["tag", "-l", `--format=${format}`, sortFlag];
    if (args.pattern) cmd.push(args.pattern);
    
    const result = await execGit(cmd, ctx.repoPath);
    const tags = parseTagOutput(result);
    
    return {
      content: [{ type: "text", text: JSON.stringify(tags, null, 2) }]
    };
  }
};
```
