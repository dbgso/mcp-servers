---
id: 01KK5EWACTPANNNY76E2SRJDSK
type: requirement
title: link_add操作時の循環参照検出
created: 2026-03-08T00:52:11.802Z
updated: 2026-03-08T00:52:11.802Z
---

# link_add操作時の循環参照検出

## 背景

interactive-instruction-mcpの`draft(action: "link_add")`操作で、relatedDocsに双方向リンクを追加すると循環参照が発生する。

lint機能は`circular-reference`ルールでこれを警告するが、link_add操作時には検出されない。

## 問題

- AIが双方向リンクを追加しようとしても、事前に警告が出ない
- confirmed: trueを呼ぶ前のプレビュー段階では循環参照を検出できない
- 承認後に初めてlintで警告される

## 要件

1. link_addのプレビュー段階で循環参照を検出する
2. 検出した場合は警告メッセージを表示する
3. AIが事前に問題に気づけるようにする
