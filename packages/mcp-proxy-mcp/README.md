# mcp-proxy-mcp

既存のMCPサーバーをラップし、ルールベースでツール呼び出しをフィルタリングする汎用プロキシMCPサーバー。

## 特徴

- 任意のMCPサーバーをラップ可能
- **3種類のアクション**: allow（許可）/ deny（拒否）/ ask（確認）
- ツール名のglobパターンマッチ (`browser_*`)
- パラメータ条件でのフィルタリング
- 優先度付きルール評価
- ルールのファイル永続化
- 実行時のルール追加・更新・削除
- **Ask機能**: ユーザーに確認を求めてから実行（デスクトップ通知）
- **Dry-runモード**: ブロックせずにログ出力のみ（ルールのデバッグ用）
- **シグナル伝達**: Ctrl+Cで親子プロセス両方を正しく終了

## インストール

```bash
npm install mcp-proxy-mcp
```

## 使い方

### CLI引数で起動

```bash
mcp-proxy-mcp \
  --command npx \
  --args @anthropic/mcp-playwright \
  --rules-file ./rules.json
```

### 設定ファイルで起動

```bash
mcp-proxy-mcp --config ./proxy-config.json
```

proxy-config.json:
```json
{
  "target": {
    "command": "npx",
    "args": ["@anthropic/mcp-playwright"]
  },
  "rulesFile": "./rules.json"
}
```

## ルール設定

### ルールファイル (rules.json)

```json
{
  "rules": [
    {
      "id": "block-delete-buttons",
      "priority": 100,
      "action": "deny",
      "toolPattern": "browser_click",
      "conditions": [
        { "param": "ref", "operator": "contains", "value": "delete" }
      ],
      "description": "deleteを含むボタンのクリックを禁止"
    },
    {
      "id": "allow-browser-tools",
      "priority": 50,
      "action": "allow",
      "toolPattern": "browser_*",
      "description": "その他のブラウザ操作は許可"
    }
  ],
  "defaultAction": "deny"
}
```

### アクションの種類

| action | 説明 |
|--------|------|
| `allow` | ツール呼び出しを許可（そのまま実行） |
| `deny` | ツール呼び出しを拒否（ブロック） |
| `ask` | ユーザーに確認を求める（承認後に実行） |

### ルールの評価順序

1. ルールを優先度順（高い方から）に評価
2. `toolPattern` がマッチするかチェック
3. `conditions` が全て満たされるかチェック（AND結合）
4. 最初にマッチしたルールの `action` を適用
5. どのルールにもマッチしない場合は `defaultAction` を適用

### toolPattern

globパターンでツール名をマッチ：

| パターン | マッチ例 |
|----------|----------|
| `browser_click` | `browser_click` のみ |
| `browser_*` | `browser_click`, `browser_navigate`, ... |
| `*` | すべてのツール |

### conditions

パラメータ条件（複数指定時はAND結合）：

| operator | 説明 | 例 |
|----------|------|-----|
| `equals` | 完全一致 | `{ "param": "ref", "operator": "equals", "value": "btn-1" }` |
| `contains` | 部分一致 | `{ "param": "ref", "operator": "contains", "value": "delete" }` |
| `matches` | 正規表現 | `{ "param": "url", "operator": "matches", "value": "^https://evil" }` |
| `exists` | 存在確認 | `{ "param": "force", "operator": "exists" }` |

ネストしたパラメータはドット記法で指定：
```json
{ "param": "options.method", "operator": "equals", "value": "DELETE" }
```

## 提供ツール

プロキシ自体が提供する管理ツール：

| ツール | 説明 |
|--------|------|
| `proxy_rule_list` | ルール一覧を表示 |
| `proxy_rule_add` | ルールを追加 |
| `proxy_rule_remove` | ルールを削除 |
| `proxy_rule_update` | ルールを更新 |
| `proxy_rule_test` | ルール評価をテスト |
| `proxy_status` | プロキシ状態を確認 |
| `proxy_set_default` | デフォルトアクションを設定 |
| `proxy_pending` | 承認待ちのツール呼び出し一覧 |
| `proxy_approve` | 承認待ちのツール呼び出しを承認 |
| `proxy_reject` | 承認待ちのツール呼び出しを拒否 |

## 使用例

### Playwright MCPをラップ

```json
{
  "rules": [
    {
      "id": "block-dangerous-buttons",
      "priority": 100,
      "action": "deny",
      "toolPattern": "browser_click",
      "conditions": [
        { "param": "ref", "operator": "matches", "value": "delete|remove|destroy" }
      ],
      "description": "危険なボタンのクリックを禁止"
    },
    {
      "id": "block-external-navigation",
      "priority": 90,
      "action": "deny",
      "toolPattern": "browser_navigate",
      "conditions": [
        { "param": "url", "operator": "matches", "value": "^https?://(?!localhost)" }
      ],
      "description": "外部サイトへのナビゲーション禁止"
    },
    {
      "id": "block-js-eval",
      "priority": 80,
      "action": "deny",
      "toolPattern": "browser_evaluate",
      "description": "JavaScript実行を禁止"
    },
    {
      "id": "allow-all-browser",
      "priority": 10,
      "action": "allow",
      "toolPattern": "browser_*",
      "description": "その他は許可"
    }
  ],
  "defaultAction": "deny"
}
```

### 実行時にルールを追加

```
proxy_rule_add({
  priority: 200,
  action: "deny",
  toolPattern: "browser_click",
  conditions: [{ param: "ref", operator: "contains", value: "payment" }],
  description: "支払いボタンを一時的にブロック"
})
```

## Ask機能（承認フロー）

危険な操作を実行前にユーザーに確認を求める機能：

```json
{
  "rules": [
    {
      "id": "ask-before-delete",
      "priority": 100,
      "action": "ask",
      "toolPattern": "browser_click",
      "conditions": [
        { "param": "ref", "operator": "contains", "value": "delete" }
      ],
      "description": "削除ボタンは確認してから実行"
    }
  ]
}
```

### Askの動作フロー

1. ツール呼び出しが `ask` ルールにマッチ
2. デスクトップ通知で承認トークンを表示
3. 呼び出し元に「承認待ち」レスポンスを返す（Request IDを含む）
4. ユーザーが `proxy_approve` で承認するか `proxy_reject` で拒否
5. 承認された場合のみ、元のツールが実行される

### 承認コマンド例

```
// 承認待ち一覧を確認
proxy_pending()

// 承認（トークンはデスクトップ通知に表示される）
proxy_approve({ requestId: "01ABC...", approvalToken: "1234" })

// 拒否
proxy_reject({ requestId: "01ABC..." })
```

## Dry-runモード

ルールをテストしたいときに、実際にブロックせずにログだけ出力するモード：

```bash
mcp-proxy-mcp --config ./proxy-config.json --dry-run
```

または設定ファイルで：

```json
{
  "target": { "command": "npx", "args": ["@anthropic/mcp-playwright"] },
  "rulesFile": "./rules.json",
  "dryRun": true
}
```

Dry-runモードでは：
- ブロック対象の呼び出しがログに出力される（stderr）
- 実際にはブロックされず、ツールは実行される
- 結果に `[DRY-RUN NOTE]` が付与される

## Claude Code設定例

```json
{
  "mcpServers": {
    "playwright-filtered": {
      "command": "npx",
      "args": [
        "mcp-proxy-mcp",
        "--command", "npx",
        "--args", "@anthropic/mcp-playwright",
        "--rules-file", "./playwright-rules.json"
      ]
    }
  }
}
```

## License

MIT
