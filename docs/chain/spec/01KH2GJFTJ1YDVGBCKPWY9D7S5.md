---
id: 01KH2GJFTJ1YDVGBCKPWY9D7S5
type: spec
requires: 01KH2GE15AY5T43X16CJPTVM5G
title: show操作仕様
created: 2026-02-10T00:52:39.890Z
updated: 2026-02-10T05:30:40.652Z
content: |-
  ## 概要

  `git show`を使用したファイル/コミット内容表示。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | ref | string | Yes | コミットハッシュまたはref |
  | path | string | No | ファイルパス（省略時はコミット詳細） |

  ## 動作

  ### path指定時
  ```bash
  git show {ref}:{path}
  ```
  → ファイル内容を返す

  ### path省略時
  ```bash
  git show --stat {ref}
  ```
  → コミット詳細（author, date, message, stats）を返す
filePath: docs/chain/spec/01KH2GJFTJ1YDVGBCKPWY9D7S5.md
---

## 概要

`git show`を使用したファイル/コミット内容表示。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| ref | string | Yes | コミットハッシュまたはref |
| path | string | No | ファイルパス（省略時はコミット詳細） |

## 動作

### path指定時
```bash
git show {ref}:{path}
```
→ ファイル内容を返す

### path省略時
```bash
git show --stat {ref}
```
→ コミット詳細（author, date, message, stats）を返す
