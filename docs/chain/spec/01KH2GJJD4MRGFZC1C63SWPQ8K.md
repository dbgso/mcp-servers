---
id: 01KH2GJJD4MRGFZC1C63SWPQ8K
type: spec
requires: 01KH2GE2S0WQ1DCMTCN34632R3
title: tag_list操作仕様
created: 2026-02-10T00:52:42.532Z
updated: 2026-02-10T05:30:41.513Z
content: |-
  ## 概要

  `git tag`を使用したタグ一覧取得。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | pattern | string | No | タグ名パターンでフィルタ |
  | sort | string | No | ソート順（version, date）（デフォルト: version） |

  ## 実行コマンド

  ```bash
  git tag -l --format="%(refname:short)|%(objectname:short)|%(creatordate:iso8601)|%(subject)" [--sort=-version:refname] {pattern}
  ```

  ## 出力形式

  JSON配列:
  ```json
  [
    {"name": "v1.0.0", "hash": "abc123", "date": "2024-01-01T00:00:00Z", "message": "..."}
  ]
  ```
filePath: docs/chain/spec/01KH2GJJD4MRGFZC1C63SWPQ8K.md
---

## 概要

`git tag`を使用したタグ一覧取得。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| pattern | string | No | タグ名パターンでフィルタ |
| sort | string | No | ソート順（version, date）（デフォルト: version） |

## 実行コマンド

```bash
git tag -l --format="%(refname:short)|%(objectname:short)|%(creatordate:iso8601)|%(subject)" [--sort=-version:refname] {pattern}
```

## 出力形式

JSON配列:
```json
[
  {"name": "v1.0.0", "hash": "abc123", "date": "2024-01-01T00:00:00Z", "message": "..."}
]
```
