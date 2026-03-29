---
id: 01KJKT7VHY1GR7FT9HP4JDX5QB
type: requirement
title: Dockerパッケージのバージョン管理方法の統一
created: 2026-03-01T04:24:24.383Z
updated: 2026-03-01T04:24:24.383Z
---

## 要件

monorepo内の全パッケージ（npm/Docker）を統一的な方法でバージョン管理したい。

## 背景

- npmパッケージ: Changesetsで管理済み
- Dockerパッケージ: 管理方法未定義（python-diagrams-mcp等）

## 期待する成果

1. 開発者が単一のワークフローで全パッケージをリリースできる
2. 自動的にCHANGELOGが生成される
3. バージョン更新の漏れを防止できる
