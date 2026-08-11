---
id: 01KH2GJFC2Z3WFFHHM40W1K450
type: spec
requires: 01KH2GE0Z1R41400Q6RQGP90QY
title: ls_files操作仕様
created: 2026-02-10T00:52:39.426Z
updated: 2026-02-10T05:30:40.521Z
content: >-
  ## 概要


  `git ls-tree`を使用したファイル一覧取得。


  ## パラメータ


  | 名前 | 型 | 必須 | 説明 |

  |------|-----|------|------|

  | ref | string | No | 対象ref（デフォルト: HEAD） |

  | path | string | No | パスパターンでフィルタ |

  | recursive | boolean | No | サブディレクトリも含む（デフォルト: true） |


  ## 実行コマンド


  ```bash

  git ls-tree [-r] --long {ref} {path}

  ```


  ## 出力形式


  JSON配列:

  ```json

  [
    {"mode": "100644", "type": "blob", "hash": "abc123", "size": 1234, "path": "src/index.ts"}
  ]

  ```
filePath: docs/chain/spec/01KH2GJFC2Z3WFFHHM40W1K450.md
---

## 概要

`git ls-tree`を使用したファイル一覧取得。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| ref | string | No | 対象ref（デフォルト: HEAD） |
| path | string | No | パスパターンでフィルタ |
| recursive | boolean | No | サブディレクトリも含む（デフォルト: true） |

## 実行コマンド

```bash
git ls-tree [-r] --long {ref} {path}
```

## 出力形式

JSON配列:
```json
[
  {"mode": "100644", "type": "blob", "hash": "abc123", "size": 1234, "path": "src/index.ts"}
]
```
