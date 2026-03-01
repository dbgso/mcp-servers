---
id: 01KJKTBFV6K7FKPNBDRQM3JAZG
type: proposal
title: ChangesetsでDockerパッケージを管理
requires: 01KJKT7VHY1GR7FT9HP4JDX5QB
created: 2026-03-01T04:26:23.462Z
updated: 2026-03-01T04:26:23.462Z
---

## 選択肢

### Option A: Changesetsで統一管理 ★推奨

`private: true`のpackage.jsonを追加し、Changesetsでバージョン管理。

**メリット:**
- 統一されたワークフロー（`pnpm changeset`）
- 自動CHANGELOG生成
- 一貫したリリースプロセス

**デメリット:**
- 非JSパッケージにpackage.jsonが必要（違和感あり）
- 新規参加者への説明が必要

### Option B: 手動タグ管理

```bash
git tag python-diagrams-mcp-v1.0.0
git push origin python-diagrams-mcp-v1.0.0
```

**メリット:**
- シンプル
- package.json不要

**デメリット:**
- バージョン更新を忘れやすい
- CHANGELOG生成なし
- npmパッケージと異なるプロセス

### Option C: 別ツール（Changepacks等）

polyglot対応の別ツールを使用。

**メリット:**
- JS依存なし

**デメリット:**
- エコシステムが小さい
- 追加依存

## 推奨: Option A

Changesetsはpackage.json必須の設計だが、統一ワークフローのメリットが大きい。違和感はADRで背景を文書化することで解決。

## 参考

- [Changesets Discussion #1230](https://github.com/changesets/changesets/discussions/1230)
- [Using Changesets in a Polyglot Monorepo](https://luke.hsiao.dev/blog/changesets-polyglot-monorepo/)
