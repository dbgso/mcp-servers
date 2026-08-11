---
id: 01KH2GN3RTCDE278AP9NP85ZWN
type: design
requires: 01KH2GJCY0YNPWY5EJW3X775VG
title: resolveRepo実装設計
created: 2026-02-10T00:54:05.851Z
updated: 2026-02-10T05:29:45.401Z
content: |-
  ## 実装ファイル

  `packages/mcp-git-repo-explorer/src/git/resolver.ts`

  ## クラス設計

  ```typescript
  export class RepoResolver {
    constructor(private cacheDir: string) {}
    
    async resolve(repoUrl?: string): Promise<string> {
      if (!repoUrl) {
        return this.resolveLocal();
      }
      return this.resolveRemote(repoUrl);
    }
    
    private async resolveLocal(): Promise<string> {
      // git rev-parse --git-dirで検証
    }
    
    private async resolveRemote(url: string): Promise<string> {
      const hash = this.hashUrl(url);
      const cachePath = path.join(this.cacheDir, hash);
      // clone or fetch
    }
  }
  ```

  ## 依存関係

  - `child_process.execFile` - Gitコマンド実行
  - `crypto` - URLハッシュ生成
filePath: docs/chain/design/01KH2GN3RTCDE278AP9NP85ZWN.md
---

## 実装ファイル

`packages/mcp-git-repo-explorer/src/git/resolver.ts`

## クラス設計

```typescript
export class RepoResolver {
  constructor(private cacheDir: string) {}
  
  async resolve(repoUrl?: string): Promise<string> {
    if (!repoUrl) {
      return this.resolveLocal();
    }
    return this.resolveRemote(repoUrl);
  }
  
  private async resolveLocal(): Promise<string> {
    // git rev-parse --git-dirで検証
  }
  
  private async resolveRemote(url: string): Promise<string> {
    const hash = this.hashUrl(url);
    const cachePath = path.join(this.cacheDir, hash);
    // clone or fetch
  }
}
```

## 依存関係

- `child_process.execFile` - Gitコマンド実行
- `crypto` - URLハッシュ生成
