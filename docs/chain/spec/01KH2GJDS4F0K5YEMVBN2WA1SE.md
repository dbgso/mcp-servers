---
id: 01KH2GJDS4F0K5YEMVBN2WA1SE
type: spec
requires: 01KH2GE0GKFN33C31HV8TV54BH
title: git_describeツール仕様
created: 2026-02-10T00:52:37.797Z
updated: 2026-02-10T05:30:40.091Z
content: |-
  ## 概要

  利用可能な操作の一覧と詳細を提供するMCPツール。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | operation | string | No | 操作IDを指定すると詳細表示 |

  ## 動作

  ### 引数なし
  全操作の一覧を表示:
  - 操作ID
  - 概要説明
  - カテゴリ分け（Search, File, History, Reference）

  ### operation指定時
  指定操作の詳細を表示:
  - パラメータのJSON Schema
  - 使用例
  - 注意事項
filePath: docs/chain/spec/01KH2GJDS4F0K5YEMVBN2WA1SE.md
---

## 概要

利用可能な操作の一覧と詳細を提供するMCPツール。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| operation | string | No | 操作IDを指定すると詳細表示 |

## 動作

### 引数なし
全操作の一覧を表示:
- 操作ID
- 概要説明
- カテゴリ分け（Search, File, History, Reference）

### operation指定時
指定操作の詳細を表示:
- パラメータのJSON Schema
- 使用例
- 注意事項
