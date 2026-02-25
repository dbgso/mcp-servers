---
whenToUse:
  - Getting started with project coding standards
  - Finding relevant coding rule documents
  - Understanding project quality requirements
  - Onboarding new team members
---

# コーディング規約 概要

このドキュメントは、プロジェクト全体のコーディング規約の概要と各詳細ドキュメントへの参照を提供する。

## 基本原則

1. **可読性**: コードは書く時間より読む時間の方が長い。読みやすさを最優先する。
2. **保守性**: 将来の変更に対応しやすい設計を心がける。
3. **一貫性**: プロジェクト全体で統一されたスタイルを維持する。
4. **テスト可能性**: テストしやすいコードを書く。

## 規約一覧

### 言語・フレームワーク固有

| ドキュメント | 説明 |
|------------|------|
| [typescript](coding-rules__typescript) | TypeScript固有の規約 |

### コードスタイル

| ドキュメント | 説明 |
|------------|------|
| [general](coding-rules__general) | 一般的なコーディングルール |
| [style](coding-rules__style) | DRY原則とコード共通化 |
| [english-comments](coding-rules__english-comments) | コメントは英語で記述 |
| [if-statement-comments](coding-rules__if-statement-comments) | if文へのコメント追加ルール |

### 設計パターン

| ドキュメント | 説明 |
|------------|------|
| [early-return](coding-rules__early-return) | 早期リターンの使用 |
| [polymorphism](coding-rules__polymorphism) | ポリモーフィズムの活用 |
| [handler-pattern](coding-rules__handler-pattern) | ハンドラーパターン |
| [ternary-testability](coding-rules__ternary-testability) | 三項演算子とテスト容易性 |

### MCP固有

| ドキュメント | 説明 |
|------------|------|
| [mcp-tool-design](coding-rules__mcp-tool-design) | MCPツールの設計原則 |
| [mcp-tool-approval](coding-rules__mcp-tool-approval) | 承認レベルのガイドライン |
| [mcp-tool-testing](coding-rules__mcp-tool-testing) | MCPツールのテストプロセス |
| [mcp-tool-help-pattern](coding__mcp-tool-help-pattern) | helpパラメータの実装 |

### 品質保証

| ドキュメント | 説明 |
|------------|------|
| [test-coverage](coding-rules__test-coverage) | テストカバレッジ95%以上必須 |

## クイックリファレンス

### 必須事項

- テストカバレッジ **95%以上** を維持
- コメントは **英語** で記述
- **早期リターン** を使用（ネストを減らす）
- **ポリモーフィズム** を活用（switch/if文を減らす）
- MCPツールには **helpパラメータ** を実装

### 禁止事項

- `any`型の使用（やむを得ない場合は `unknown` を検討）
- コメントなしの複雑な条件分岐
- テストなしのコードマージ
- 95%未満のカバレッジでのリリース

## 新規ルールの追加

新しいコーディングルールを追加する場合：

1. `docs/coding-rules/` 配下に新規ドキュメントを作成
2. 本概要ドキュメントの該当セクションに追加
3. チームへの周知を行う
