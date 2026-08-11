---
id: 01KH2GJGTZ4N5G93AFXCSKBD7Q
type: spec
requires: 01KH2GE1PEZMG7BYEFM5NR012K
title: blame操作仕様
created: 2026-02-10T00:52:40.927Z
updated: 2026-02-10T05:30:40.951Z
content: >-
  ## 概要


  `git blame`を使用した行ごとの変更者追跡。


  ## パラメータ


  | 名前 | 型 | 必須 | 説明 |

  |------|-----|------|------|

  | path | string | Yes | ファイルパス |

  | ref | string | No | 対象ref（デフォルト: HEAD） |

  | start_line | number | No | 開始行 |

  | end_line | number | No | 終了行 |


  ## 実行コマンド


  ```bash

  git blame --porcelain [-L {start},{end}] {ref} -- {path}

  ```


  ## 出力形式


  JSON配列:

  ```json

  [
    {"line": 1, "hash": "abc123", "author": "name", "date": "2024-01-01T00:00:00Z", "content": "..."}
  ]

  ```
filePath: docs/chain/spec/01KH2GJGTZ4N5G93AFXCSKBD7Q.md
---

## 概要

`git blame`を使用した行ごとの変更者追跡。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| path | string | Yes | ファイルパス |
| ref | string | No | 対象ref（デフォルト: HEAD） |
| start_line | number | No | 開始行 |
| end_line | number | No | 終了行 |

## 実行コマンド

```bash
git blame --porcelain [-L {start},{end}] {ref} -- {path}
```

## 出力形式

JSON配列:
```json
[
  {"line": 1, "hash": "abc123", "author": "name", "date": "2024-01-01T00:00:00Z", "content": "..."}
]
```
