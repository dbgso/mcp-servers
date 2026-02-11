---
id: 01KH2GJDA2R5MXP83SXKFW4X32
type: spec
requires: 01KH2GE08FACCP09GJHHHS9J97
title: bare_cloneキャッシュディレクトリ構造
created: 2026-02-10T00:52:37.314Z
updated: 2026-02-10T05:30:39.947Z
content: |-
  ## 概要

  リモートリポジトリのbare cloneを格納するディレクトリ構造。

  ## 仕様

  ### ディレクトリ構成
  ```
  {cacheDir}/
    {hash1}/  # URL hash
      HEAD
      objects/
      refs/
    {hash2}/
      ...
  ```

  ### ハッシュ生成
  - URLをsha256でハッシュ
  - 最初の12文字を使用

  ### キャッシュディレクトリ
  - CLI引数で指定可能
  - デフォルト: `/tmp/mcp-git-repos`
filePath: docs/chain/spec/01KH2GJDA2R5MXP83SXKFW4X32.md
---

## 概要

リモートリポジトリのbare cloneを格納するディレクトリ構造。

## 仕様

### ディレクトリ構成
```
{cacheDir}/
  {hash1}/  # URL hash
    HEAD
    objects/
    refs/
  {hash2}/
    ...
```

### ハッシュ生成
- URLをsha256でハッシュ
- 最初の12文字を使用

### キャッシュディレクトリ
- CLI引数で指定可能
- デフォルト: `/tmp/mcp-git-repos`
