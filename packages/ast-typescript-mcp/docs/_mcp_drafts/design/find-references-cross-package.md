# find_references クロスパッケージ参照の設計

pnpm monorepo 環境でのクロスパッケージ参照検索における課題と解決策の調査記録。

## 課題

`handler.execute()` の参照検索で、`handler` がインターフェース型の場合：

```
呼び出し: plan/index.ts の handler.execute()
    ↓ TypeScript が解決
定義: dist/tools/action-registry.d.ts (インターフェース)
    ≠
期待: src/tools/base-action-handler.ts (クラス実装)
```

## 原因

pnpm workspace では依存パッケージは `node_modules` 経由で解決され、`package.json` の `exports` が `dist/` を指すため `.d.ts` に解決される。

## 調査した対策

### tsc -b (project references)

```json
// tsconfig.json
{
  "compilerOptions": { "composite": true },
  "references": [{ "path": "../mcp-shared" }]
}
```

**結果**: ビルド順序管理のみ。ts-morph の Language Service には影響なし。

### declarationMap

`declarationMap: true` は設定済み。`.d.ts.map` は生成される。

**結果**: VSCode は使用するが、ts-morph の `getDefinitions()` API は自動で辿らない。

### ts-morph の継承関係 API

```typescript
class.getImplements()           // 明示的 implements のみ
interface.getImplementations()  // プロジェクトスコープ内のみ
```

**結果**: ダックタイピング・クロスパッケージは検出不可。

## 採用した解決策

「同じパッケージ + 同じシンボル名」でマッチング：

```typescript
const definitionPackage = this.getPackageName(definitionFilePath);
const matchesDefinition = defs.some((def) => {
  const defPath = def.getSourceFile().getFilePath();
  if (defPath === definitionFilePath) return true;
  if (definitionPackage && this.getPackageName(defPath) === definitionPackage) {
    return true;
  }
  return false;
});

private getPackageName(filePath: string): string | null {
  const match = filePath.match(/packages\/([^/]+)/);
  return match ? match[1] : null;
}
```

## トレードオフ

- **利点**: インターフェース経由の参照を検出可能
- **欠点**: 同一パッケージ内の無関係な同名シンボルも誤検出の可能性
