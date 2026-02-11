---
id: 01KH2GJEBPKMDKM6RY8RXJNA16
type: spec
requires: 01KH2GE0GKFN33C31HV8TV54BH
title: git_executeツール仕様
created: 2026-02-10T00:52:38.390Z
updated: 2026-02-10T05:30:40.234Z
content: |-
  ## 概要

  実際のGit操作を実行するMCPツール。

  ## パラメータ

  | 名前 | 型 | 必須 | 説明 |
  |------|-----|------|------|
  | operation | string | Yes | 操作ID |
  | params | object | No | 操作固有のパラメータ |

  ## 動作

  1. 操作IDからハンドラを検索
  2. paramsをZodスキーマで検証
  3. 検証成功時、ハンドラを実行
  4. 結果をMCP形式で返却

  ## エラー処理

  - 不明な操作ID: 利用可能な操作一覧を返す
  - パラメータ検証エラー: 詳細なエラーメッセージを返す
  - Git実行エラー: stderrを含めて返す
filePath: docs/chain/spec/01KH2GJEBPKMDKM6RY8RXJNA16.md
---

## 概要

実際のGit操作を実行するMCPツール。

## パラメータ

| 名前 | 型 | 必須 | 説明 |
|------|-----|------|------|
| operation | string | Yes | 操作ID |
| params | object | No | 操作固有のパラメータ |

## 動作

1. 操作IDからハンドラを検索
2. paramsをZodスキーマで検証
3. 検証成功時、ハンドラを実行
4. 結果をMCP形式で返却

## エラー処理

- 不明な操作ID: 利用可能な操作一覧を返す
- パラメータ検証エラー: 詳細なエラーメッセージを返す
- Git実行エラー: stderrを含めて返す
