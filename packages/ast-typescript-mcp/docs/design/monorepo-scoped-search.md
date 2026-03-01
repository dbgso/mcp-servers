# モノレポスコープ検索の設計

find_references のモノレポ最適化の内部設計。依存グラフを活用して検索範囲を限定し、パフォーマンスを向上させる。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    find_references                          │
├─────────────────────────────────────────────────────────────┤
│  1. git grep (シンボル名で候補ファイル取得)                  │
│  2. filterToDependentPackages (スコープ有効時)               │
│  3. findReferencesInFile (各ファイルを解析)                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              filterToDependentPackages                       │
├─────────────────────────────────────────────────────────────┤
│  1. detectWorkspace → WorkspaceInfo                          │
│  2. parseAllPackages → PackageInfo[]                         │
│  3. findPackageForFile → ターゲットパッケージ特定            │
│  4. buildMonorepoGraph → 依存グラフ構築                      │
│  5. getDependentPackages → 逆依存パッケージ取得              │
│  6. candidateFiles.filter → 依存パッケージ内のみ抽出         │
└─────────────────────────────────────────────────────────────┘
```

## 高速化の仕組み

### 従来の検索フロー

```
git grep "symbolName" → 全ファイル (100ファイル)
  → ts-morph parse × 100
  → 6650ms
```

### スコープ検索フロー

```
git grep "symbolName" → 全ファイル (100ファイル)
  → 依存パッケージでフィルタ → 40ファイル
  → ts-morph parse × 40
  → 3183ms
```

**ポイント:**
- git grep は高速なので全検索のままでも問題ない
- ts-morph の parse がボトルネック → ファイル数削減で高速化
- フィルタリングコスト（ワークスペース検出 + グラフ構築）は数十ms

## モジュール構成

```
src/monorepo/
├── workspace-detector.ts  # pnpm/npm/yarn ワークスペース検出
├── package-resolver.ts    # package.json 解析、パッケージマップ構築
├── graph-builder.ts       # 依存グラフ構築、循環検出
└── index.ts               # エクスポート
```

### workspace-detector.ts

ディレクトリを上に辿り、ワークスペース設定を検出:
1. `pnpm-workspace.yaml` → pnpm
2. `package.json#workspaces` → npm/yarn

### graph-builder.ts

**循環検出アルゴリズム:** Tarjan's SCC (Strongly Connected Components)
- 深さ優先探索で強連結成分を検出
- O(V + E) の計算量

## リスクと対策

### 1. 検索漏れリスク

**状況:** 依存関係が package.json に記載されていない場合

**例:**
- 相対パスでの直接 import (`../../other-package/src/utils`)
- 動的 import
- monorepo 外からのコピー&ペースト

**対策:**
- デフォルトは `scope_to_dependents: false`（全検索）
- ユーザーが明示的に有効化した場合のみスコープ検索
- 完全性が必要な場合は unscoped 検索を使用

### 2. ワークスペース検出失敗

**状況:**
- 非標準のワークスペース構成
- nested monorepo
- Lerna 単独使用（workspaces 未設定）

**対策:**
- 検出失敗時は自動的に全ファイル検索にフォールバック
- `null` 返却でエラーにせず、グレースフルデグレード

### 3. キャッシュ不整合

**状況:** package.json 変更後にキャッシュが古い

**現状:** キャッシュなし（毎回 package.json を読み込み）

**将来の改善案:**
- ファイル監視による差分更新
- mtime ベースのキャッシュ無効化

### 4. 大規模モノレポでのパフォーマンス

**状況:** 数百パッケージ規模のモノレポ

**対策:**
- glob パターンは並列実行可能
- package.json 読み込みは同期的だが軽量
- 必要に応じて遅延読み込み導入可能

## テスト戦略

```
src/__tests__/monorepo.test.ts
├── detectWorkspace
│   ├── pnpm ワークスペース検出
│   ├── サブディレクトリからの検出
│   └── 非ワークスペースで null
├── buildMonorepoGraph
│   ├── パッケージとエッジの構築
│   ├── 依存タイプの識別
│   └── 循環検出
├── getDependentPackages
│   ├── 逆依存の取得
│   └── 依存なしで空配列
└── findReferences with scope
    ├── スコープ検索の動作
    └── スコープあり/なしの結果比較
```
