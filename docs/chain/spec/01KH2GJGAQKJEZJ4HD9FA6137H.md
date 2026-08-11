---
id: 01KH2GJGAQKJEZJ4HD9FA6137H
type: spec
requires: 01KH2GE1F7HA9X7P77X2627P0R
title: log操作仕様
created: 2026-02-10T00:52:40.408Z
updated: 2026-02-10T05:30:40.788Z
content: >-
  ## 概要


  `git log`を使用したコミット履歴取得。


  ## パラメータ


  | 名前 | 型 | 必須 | 説明 |

  |------|-----|------|------|

  | ref | string | No | 開始ref（デフォルト: HEAD） |

  | path | string | No | ファイルパスでフィルタ |

  | limit | number | No | 最大件数（デフォルト: 20） |

  | since | string | No | 日付フィルタ |

  | author | string | No | 著者フィルタ |


  ## 実行コマンド


  ```bash

  git log --format="%H|%an|%ae|%at|%s" [-n {limit}] [--since={since}]
  [--author={author}] {ref} -- {path}

  ```


  ## 出力形式


  JSON配列:

  ```json

  [
    {"hash": "abc123", "author": "name", "email": "a@b.c", "date": "2024-01-01T00:00:00Z", "message": "..."}
  ]

  ```
filePath: docs/chain/spec/01KH2GJGAQKJEZJ4HD9FA6137H.md
---

## 概要

`git log`を使用したコミット履歴取得。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| ref | string | No | 開始ref（デフォルト: HEAD） |
| path | string | No | ファイルパスでフィルタ |
| limit | number | No | 最大件数（デフォルト: 20） |
| since | string | No | 日付フィルタ |
| author | string | No | 著者フィルタ |

## 実行コマンド

```bash
git log --format="%H|%an|%ae|%at|%s" [-n {limit}] [--since={since}] [--author={author}] {ref} -- {path}
```

## 出力形式

JSON配列:
```json
[
  {"hash": "abc123", "author": "name", "email": "a@b.c", "date": "2024-01-01T00:00:00Z", "message": "..."}
]
```
