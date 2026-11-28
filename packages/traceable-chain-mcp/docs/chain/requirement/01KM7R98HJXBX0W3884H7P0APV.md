---
id: 01KM7R98HJXBX0W3884H7P0APV
type: requirement
title: AIガイドラインとしてのウォーターフォール強制
requires: 01M8GM8GSWDMEHTNCBJ6B6TZR1
created: 2026-03-21T08:30:43.762Z
updated: 2026-11-28T08:27:31.547Z
baseline:
  01M8GM8GSWDMEHTNCBJ6B6TZR1:
    parent: d624f26aae73e451
    self: fbb741967519216a
    at: 2026-11-28T08:27:31.546Z
---

## 背景

ウォーターフォールは人間には制限だが、AIには適切なガイドライン。

## 要求

- requirement → spec → design の順序を強制
- AIがサボらないための手段として機能
- ルールが決まっていればAIは高速にこなす

## 期待効果

- 依存関係の自動検証でドキュメント孤立を防止
- 作業開始前に必須リンクを強制、全体構造を明確化
- trace操作で影響範囲を即座に可視化
