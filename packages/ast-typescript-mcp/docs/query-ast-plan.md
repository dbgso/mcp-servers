# query_ast ツール設計

## 概要

ASTノードをクエリで検索するツール。コードパターンの検出に使用。

## ユースケース

1. **ポリモーフィズム違反検出**: `instanceof` パターンを検索
2. **アンチパターン検出**: `await promise.then()` など
3. **リファクタリング候補**: 特定パターンの一括検出
4. **コーディング規約チェック**: 禁止パターンの検出

## インターフェース

```typescript
query_ast({
  // 検索対象
  path: string,              // ファイルまたはディレクトリ

  // クエリ（必須）
  query: AstQuery,

  // オプション
  limit?: number,            // 最大結果数 (default: 100)
  include?: string[],        // glob パターン (default: ["**/*.ts", "**/*.tsx"])
  exclude?: string[],        // 除外パターン (default: ["node_modules"])
})
```

## AstQuery スキーマ

```typescript
interface AstQuery {
  // ノード種別 (ts-morph SyntaxKind)
  kind: string;

  // プロパティマッチング (オプション)
  [property: string]: AstQuery | string | number | boolean | undefined;
}
```

### 特殊キー

| キー | 説明 |
|------|------|
| `kind` | SyntaxKind名 (必須) |
| `$capture` | マッチしたノードに名前を付ける |
| `$any` | 任意のノードにマッチ |
| `$text` | ノードのテキストにマッチ（正規表現可） |

## クエリ例

### 1. instanceof チェック

```typescript
{
  kind: "BinaryExpression",
  operatorToken: { kind: "InstanceOfKeyword" },
  right: { $capture: "className" }
}
```

### 2. console.log 呼び出し

```typescript
{
  kind: "CallExpression",
  expression: {
    kind: "PropertyAccessExpression",
    expression: { $text: "console" },
    name: { $text: "log" }
  }
}
```

### 3. await + .then() アンチパターン

```typescript
{
  kind: "AwaitExpression",
  expression: {
    kind: "CallExpression",
    expression: {
      kind: "PropertyAccessExpression",
      name: { $text: "then" }
    }
  }
}
```

### 4. if-else で同じ return 型

```typescript
{
  kind: "IfStatement",
  thenStatement: {
    kind: "Block",
    statements: [{
      kind: "ReturnStatement",
      $capture: "thenReturn"
    }]
  },
  elseStatement: {
    kind: "Block",
    statements: [{
      kind: "ReturnStatement",
      $capture: "elseReturn"
    }]
  }
}
```

## 出力形式

```typescript
interface QueryAstResult {
  matches: Array<{
    file: string;
    line: number;
    column: number;
    text: string;           // マッチしたノードのテキスト
    captures?: Record<string, {
      text: string;
      line: number;
    }>;
  }>;
  totalFiles: number;
  filesWithMatches: number;
}
```

## 実装方針

1. **ts-morph の forEachDescendant** でノード走査
2. **再帰的マッチング**: クエリオブジェクトとASTノードを再帰比較
3. **SyntaxKind マッピング**: 文字列 → ts.SyntaxKind 変換
4. **キャプチャ**: マッチ時に `$capture` キーの値を収集

## 実装ステップ

1. [ ] AstQuery の Zod スキーマ定義
2. [ ] マッチング関数 `matchNode(node, query)` 実装
3. [ ] ファイル走査とマッチ収集
4. [ ] キャプチャ機能
5. [ ] テスト追加

## 関連ツール

- `find_missing_abstract`: サブクラスにあってベースにないメソッドを検出
  - `query_ast` で instanceof を見つけた後、この情報でリファクタリング

---

## レビューフィードバック (2026-02-23)

### 追加すべきパラメータ

```typescript
query_ast({
  path: string,
  query: AstQuery,
  limit?: number,
  include?: string[],
  exclude?: string[],
  // 追加
  context_lines?: number,     // マッチ周辺のコード（AIコンテキスト理解）
  output_format?: "summary" | "detailed" | "json",
})
```

### 追加すべき特殊キー

| キー | 説明 | 用途 |
|------|------|------|
| `$ancestor` | 親ノードの条件 | 「このメソッド内のawait」 |
| `$not` | 否定マッチ | 「console.log以外」 |
| `$or` | OR条件 | 複数パターン同時検索 |
| `$children` | 直接の子ノード | 特定構造のブロック検出 |

### 出力形式の改善

```typescript
interface QueryAstResult {
  matches: Array<{
    file: string;
    line: number;
    column: number;
    text: string;
    contextBefore?: string[];   // 追加: 前の行
    contextAfter?: string[];    // 追加: 後の行
    parentKind?: string;        // 追加: 親ノードのkind
    captures?: Record<string, {...}>;
  }>;
  queryDiagnostics?: {          // 追加: エラーフィードバック
    parseErrors?: string[];
    warnings?: string[];
  };
}
```

### 追加実装ステップ

6. [ ] SyntaxKind の自動補完/バリデーション
7. [ ] プリセットクエリ（instanceof_check等）
8. [ ] パフォーマンス最適化（大規模ディレクトリ）
9. [ ] エラーハンドリング設計
