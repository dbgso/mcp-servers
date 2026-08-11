---
id: 01KH2GE0GKFN33C31HV8TV54BH
type: requirement
title: Describe_Executeパターン
created: 2026-02-10T00:50:13.139Z
updated: 2026-02-10T05:30:14.133Z
content: |-
  ## 背景

  MCPツールが多数の操作を持つ場合、個別のツールとして定義すると一覧性が悪くなる。

  ## 要件

  - `git_describe`: 操作一覧と詳細を提供
  - `git_execute`: 実際の操作を実行
  - 操作ごとにZodスキーマでパラメータを検証

  ## 理由

  2つのエントリーポイントに集約することで、LLMが利用可能な操作を把握しやすくなる。
filePath: docs/chain/requirement/01KH2GE0GKFN33C31HV8TV54BH.md
---

## 背景

MCPツールが多数の操作を持つ場合、個別のツールとして定義すると一覧性が悪くなる。

## 要件

- `git_describe`: 操作一覧と詳細を提供
- `git_execute`: 実際の操作を実行
- 操作ごとにZodスキーマでパラメータを検証

## 理由

2つのエントリーポイントに集約することで、LLMが利用可能な操作を把握しやすくなる。
