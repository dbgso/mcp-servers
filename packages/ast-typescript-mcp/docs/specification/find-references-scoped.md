# find_references スコープ検索仕様

find_references ツールに追加された `scope_to_dependents` オプションにより、モノレポ内で依存パッケージのみを検索対象にできる。

## オプション

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| file_path | string | Yes | シンボル定義のファイルパス |
| line | number | Yes | 行番号（1-based） |
| column | number | Yes | 列番号（1-based） |
| scope_to_dependents | boolean | No | 依存パッケージのみ検索（デフォルト: false） |

## 動作

### scope_to_dependents: false（デフォルト）

```
git grep → 全ファイル検索 → ts-morph で参照解決
```

リポジトリ内の全 TypeScript ファイルを検索対象とする。

### scope_to_dependents: true

```
git grep → 依存パッケージのファイルのみ抽出 → ts-morph で参照解決
```

1. ターゲットファイルが属するパッケージを特定
2. そのパッケージに依存するパッケージを取得
3. 依存パッケージ内のファイルのみを検索

## ユースケース

### 共通ライブラリのシンボル検索

`mcp-shared` の `jsonResponse` 関数の参照を検索する場合：

```typescript
find_references({
  file_path: "/path/to/mcp-shared/src/index.ts",
  line: 10,
  column: 14,
  scope_to_dependents: true
})
```

**結果:** `mcp-shared` に依存する4パッケージのみを検索
- ast-typescript-mcp
- ast-file-mcp
- interactive-pdca-mcp
- interactive-instruction-mcp

### パフォーマンス

| モード | 検索範囲 | 実測時間 |
|--------|---------|---------|
| unscoped | 全ファイル | 6650ms |
| scoped | 依存パッケージのみ | 3183ms |

約2倍の高速化を実現。

## 適用条件

スコープ検索が適用される条件：
1. モノレポワークスペースが検出できる
2. ターゲットファイルがパッケージ内にある
3. 依存パッケージが1つ以上存在する

条件を満たさない場合、自動的に全ファイル検索にフォールバック。
