---
id: 01KH2GJESZJQEB4FENZCM0PQ86
type: spec
requires: 01KH2GE0S47BDPZR0ZVHH2WGBR
title: grep操作仕様
created: 2026-02-10T00:52:38.847Z
updated: 2026-02-10T05:30:40.384Z
content: |-
  ## 概要

  `git grep`を使用したコード検索。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | pattern | string | Yes | 検索パターン（正規表現） |
  | path | string | No | パスパターンでフィルタ |
  | ref | string | No | 検索対象ref（デフォルト: HEAD） |
  | context | number | No | 前後の行数 |
  | ignore_case | boolean | No | 大文字小文字を無視 |

  ## 実行コマンド

  ```bash
  git grep [-i] [-C {context}] {pattern} {ref} -- {path}
  ```

  ## 出力形式

  ```
  {file}:{line}:{content}
  ```
filePath: docs/chain/spec/01KH2GJESZJQEB4FENZCM0PQ86.md
---

## 概要

`git grep`を使用したコード検索。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| pattern | string | Yes | 検索パターン（正規表現） |
| path | string | No | パスパターンでフィルタ |
| ref | string | No | 検索対象ref（デフォルト: HEAD） |
| context | number | No | 前後の行数 |
| ignore_case | boolean | No | 大文字小文字を無視 |

## 実行コマンド

```bash
git grep [-i] [-C {context}] {pattern} {ref} -- {path}
```

## 出力形式

```
{file}:{line}:{content}
```
