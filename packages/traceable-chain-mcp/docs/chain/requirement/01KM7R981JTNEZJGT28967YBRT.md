---
id: 01KM7R981JTNEZJGT28967YBRT
type: requirement
title: researchタイプの追加
requires: 01M8GM8GSWDMEHTNCBJ6B6TZR1
created: 2026-03-21T08:30:43.250Z
updated: 2026-11-28T08:27:31.533Z
baseline:
  01M8GM8GSWDMEHTNCBJ6B6TZR1:
    parent: d624f26aae73e451
    self: 2dc0d875f971f7be
    at: 2026-11-28T08:27:31.533Z
---

## 背景

調査・実験からスタートするケースで、requirementより先にresearchを記録したい。

## 要求

- researchタイプを追加
- requires: null (root可)
- researchを踏まえてrequirementを作成可能

## 理由

探索的開発では調査が先行する。調査結果を記録してから要件を明確化するフローをサポート。
