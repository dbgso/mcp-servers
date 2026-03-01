# monorepo 依存グラフ設計

monorepo 全体のパッケージ間依存関係を解析する機能の設計。pnpm/npm/yarn workspaces 対応。

## 目標

1. パッケージ間の依存関係を可視化
2. `find_references` の検索範囲を絞り込み
3. 影響範囲分析（変更時の再ビルド対象特定）

## API 設計

```typescript
interface MonorepoGraphParams {
  /** monorepo ルートディレクトリ */
  rootDir: string;
  /** 内部パッケージのみ (default: true) */
  internalOnly?: boolean;
  /** ファイルレベルの依存も含める (default: false) */
  includeFiles?: boolean;
}

interface PackageNode {
  /** パッケージ名 (package.json#name) */
  name: string;
  /** パッケージディレクトリ */
  path: string;
  /** エントリポイント */
  main?: string;
}

interface PackageEdge {
  /** 依存元パッケージ名 */
  from: string;
  /** 依存先パッケージ名 */
  to: string;
  /** 依存の種類 */
  type: "dependencies" | "devDependencies" | "peerDependencies";
}

interface MonorepoGraphResult {
  /** ワークスペースタイプ */
  workspaceType: "pnpm" | "npm" | "yarn";
  /** パッケージノード */
  packages: PackageNode[];
  /** パッケージ間依存 */
  edges: PackageEdge[];
  /** 循環依存 */
  cycles: string[][];
}
```

## 実装ステップ

### Phase 1: ワークスペース検出

```typescript
// 優先順位で検出
1. pnpm-workspace.yaml
2. package.json#workspaces (npm/yarn)
```

### Phase 2: パッケージ解析

```typescript
// 各パッケージの package.json から
- name
- dependencies / devDependencies / peerDependencies
- exports / main / types
```

### Phase 3: 内部依存フィルタ

```typescript
// workspace 内のパッケージのみ抽出
const internalPackages = new Set(packages.map(p => p.name));
const internalEdges = edges.filter(e => internalPackages.has(e.to));
```

### Phase 4: find_references 統合

```typescript
// 依存グラフを使って検索範囲を絞り込み
async findReferences(filePath, line, column) {
  const pkg = getPackageForFile(filePath);
  const dependents = getDependentPackages(pkg); // このパッケージに依存しているパッケージ
  const searchDirs = [pkg.path, ...dependents.map(d => d.path)];
  // searchDirs 内のファイルのみを検索
}
```

## ファイル構成

```
packages/ast-typescript-mcp/src/
├── handlers/
│   └── typescript.ts          # 既存
├── monorepo/
│   ├── workspace-detector.ts  # ワークスペース検出
│   ├── package-resolver.ts    # パッケージ名→パス解決
│   └── graph-builder.ts       # グラフ構築
└── tools/handlers/
    └── monorepo-graph.ts      # MCP ツールハンドラ
```
