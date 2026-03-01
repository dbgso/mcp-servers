# monorepo_graph / package_dependents 仕様

モノレポ内のパッケージ依存関係を解析し、依存グラフと逆依存情報を取得するツール群。pnpm, npm, yarn ワークスペースに対応。

## ツール

### monorepo_graph

モノレポ全体の依存グラフを取得する。

**入力パラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| root_dir | string | Yes | モノレポルート（または内部の任意ディレクトリ） |
| include_dev | boolean | No | devDependencies を含める（デフォルト: true） |

**出力:**

```json
{
  "workspaceType": "pnpm" | "npm" | "yarn",
  "rootDir": "/path/to/monorepo",
  "packages": [
    {
      "name": "package-name",
      "relativePath": "packages/package-name"
    }
  ],
  "edges": [
    {
      "from": "package-a",
      "to": "package-b",
      "type": "dependencies" | "devDependencies" | "peerDependencies"
    }
  ],
  "cycles": []
}
```

**ユースケース:**
- モノレポ構造の可視化
- 依存関係の把握
- 循環依存の検出

### package_dependents

指定パッケージに依存しているパッケージを取得する（逆依存）。

**入力パラメータ:**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| root_dir | string | Yes | モノレポルート |
| package_name | string | Yes | 対象パッケージ名 |

**出力:**

```json
{
  "packageName": "mcp-shared",
  "dependentCount": 4,
  "dependents": [
    { "name": "ast-typescript-mcp", "relativePath": "packages/ast-typescript-mcp" },
    { "name": "ast-file-mcp", "relativePath": "packages/ast-file-mcp" }
  ]
}
```

**ユースケース:**
- 影響分析: パッケージ変更時の影響範囲特定
- リリース計画: 依存パッケージの再ビルド対象特定
- リファクタリング: 変更の波及範囲把握

## サポートするワークスペース

| ワークスペース | 検出ファイル |
|--------------|-------------|
| pnpm | pnpm-workspace.yaml |
| npm/yarn | package.json#workspaces |

## 制限事項

- 内部パッケージ間の依存のみ解析（外部パッケージは対象外）
- package.json が存在しないディレクトリはスキップ
