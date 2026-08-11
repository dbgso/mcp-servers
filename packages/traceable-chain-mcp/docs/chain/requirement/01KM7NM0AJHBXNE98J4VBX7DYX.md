---
id: 01KM7NM0AJHBXNE98J4VBX7DYX
type: requirement
title: traceable-chain-mcp
created: 2026-03-21T07:44:10.066Z
updated: 2026-03-21T07:44:10.066Z
---

## 概要

ドキュメントの依存関係を強制し、トレーサビリティを確保するMCPサーバー。

## 背景

ソフトウェアプロジェクトでは、ドキュメントが断片化しがち:
- 要件に紐付かない仕様書
- 仕様に紐付かない設計書
- 文脈のない意思決定

問題が発生した時、「なぜそう作ったのか」を追跡できない。

## 解決策

依存関係チェーンを強制:

```
requirement → spec → design → implementation
                 ↘ proposal → adr
                 ↘ test
```

全てのドキュメントは親にリンクする必要がある。孤立した仕様書は許さない。
