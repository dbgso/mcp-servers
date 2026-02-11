---
id: 01KH2GJHBNYED2GZV2G4SYSN79
type: spec
requires: 01KH2GE23325B5WKN4PDJ2GBB4
title: diff操作仕様
created: 2026-02-10T00:52:41.462Z
updated: 2026-02-10T05:30:41.095Z
content: |-
  ## 概要

  `git diff`を使用した差分表示。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | from_ref | string | Yes | 比較元ref |
  | to_ref | string | No | 比較先ref（デフォルト: HEAD） |
  | path | string | No | ファイルパスでフィルタ |
  | stat_only | boolean | No | 統計のみ表示 |

  ## 実行コマンド

  ```bash
  git diff [--stat] {from_ref}..{to_ref} -- {path}
  ```

  ## 出力形式

  ### stat_only=true
  ```
   src/index.ts | 10 +++++-----
   1 file changed, 5 insertions(+), 5 deletions(-)
  ```

  ### stat_only=false
  標準のunified diff形式
filePath: docs/chain/spec/01KH2GJHBNYED2GZV2G4SYSN79.md
---

## 概要

`git diff`を使用した差分表示。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| from_ref | string | Yes | 比較元ref |
| to_ref | string | No | 比較先ref（デフォルト: HEAD） |
| path | string | No | ファイルパスでフィルタ |
| stat_only | boolean | No | 統計のみ表示 |

## 実行コマンド

```bash
git diff [--stat] {from_ref}..{to_ref} -- {path}
```

## 出力形式

### stat_only=true
```
 src/index.ts | 10 +++++-----
 1 file changed, 5 insertions(+), 5 deletions(-)
```

### stat_only=false
標準のunified diff形式
