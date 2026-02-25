---
whenToUse:
  - Designing new MCP tools
  - Adding new actions to MCP tools
  - Deciding which tool should contain an action
  - Reviewing MCP tool security
---

# MCP Tool Approval Levels

MCPツールの承認レベルに関するガイドライン。

## 重要な原則

**MCPツールはツールレベルで承認される（actionレベルではない）**

Claude Codeでは、ツール単位でauto-approve設定ができる。例えば`plan`ツールをauto-approvedに設定すると、そのツールの全てのactionが自動承認される。

## 設計指針

### ユーザー承認が必要なアクション

以下のようなアクションは、auto-approved対象外のツールに配置すべき:

- ファイルシステムへの書き込み
- 外部サービスへの接続
- 不可逆な操作（削除など）
- ユーザーの明示的な意思決定が必要な操作

### 例: approve tool

`approve`ツールは設計上、常にユーザー承認を要求する。重要なアクションの配置先として適切:

```typescript
// Good: approve toolに配置（ユーザー承認必須）
approve(target: "setup_templates")
approve(target: "deletion", task_id: "...")

// Bad: plan toolに配置（auto-approved可能）
plan(action: "setup_templates")  // ユーザー承認なしで実行される可能性
```

## 実装時のチェックリスト

新しいアクションを追加する際:

1. [ ] このアクションはユーザーの明示的な承認が必要か？
2. [ ] 配置先のツールはauto-approved対象になりうるか？
3. [ ] 承認が必要なら、approve toolまたは同等の非auto-approvedツールに配置
