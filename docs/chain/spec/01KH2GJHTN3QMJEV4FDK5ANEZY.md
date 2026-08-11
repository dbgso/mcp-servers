---
id: 01KH2GJHTN3QMJEV4FDK5ANEZY
type: spec
requires: 01KH2GE2EEV6RVZKRKFY2KJDRN
title: branch_list操作仕様
created: 2026-02-10T00:52:41.941Z
updated: 2026-02-10T05:30:41.260Z
content: |-
  ## 概要

  `git branch`を使用したブランチ一覧取得。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | remote | boolean | No | リモートブランチを含む（デフォルト: true） |
  | pattern | string | No | ブランチ名パターンでフィルタ |

  ## 実行コマンド

  ```bash
  git branch [-a] --format="%(refname:short)|%(objectname:short)|%(committerdate:iso8601)|%(subject)"
  ```

  ## 出力形式

  JSON配列:
  ```json
  [
    {"name": "main", "hash": "abc123", "date": "2024-01-01T00:00:00Z", "message": "..."}
  ]
  ```
filePath: docs/chain/spec/01KH2GJHTN3QMJEV4FDK5ANEZY.md
---

## 概要

`git branch`を使用したブランチ一覧取得。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| remote | boolean | No | リモートブランチを含む（デフォルト: true） |
| pattern | string | No | ブランチ名パターンでフィルタ |

## 実行コマンド

```bash
git branch [-a] --format="%(refname:short)|%(objectname:short)|%(committerdate:iso8601)|%(subject)"
```

## 出力形式

JSON配列:
```json
[
  {"name": "main", "hash": "abc123", "date": "2024-01-01T00:00:00Z", "message": "..."}
]
```
