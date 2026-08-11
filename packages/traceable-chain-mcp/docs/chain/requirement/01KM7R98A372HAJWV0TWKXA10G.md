---
id: 01KM7R98A372HAJWV0TWKXA10G
type: requirement
title: draftモードの実装
created: 2026-03-21T08:30:43.523Z
updated: 2026-03-21T08:30:43.523Z
---

## 背景

意思決定の過程で多くの情報が生成される。すべてを正式記録するとゴミ情報が増える。

## 要求

- draftモードで一時記録
- 振り返ってきれいにした状態で正式記録に昇格
- 昇格時にstatus=approvedを保持(監査証跡)

## 実現方法案

- タイプ接頭辞方式: draft_requirement等
- または interactive-instruction-mcp との連携
