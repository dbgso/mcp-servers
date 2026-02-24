---
description: TypeScript コードの大規模変更には ts_codemod を使う。sed や手動置換ではなく AST ベースの変換を行う。
whenToUse:
  - TypeScript ファイルの大規模リファクタリング
  - 関数シグネチャの一括変更
  - パターンマッチによる複数箇所の置換
  - 3箇所以上の同一パターン変更
---

# TypeScript 大規模リファクタリング: ts_codemod の利用

## 原則

TypeScript コードを複数箇所変更する場合、**sed や手動置換ではなく ts_codemod を使用する**。

### なぜ ts_codemod か

| 手法 | 問題点 |
|------|--------|
| sed | 構文を理解しない。括弧の対応やインデントを壊しやすい |
| 手動 Edit | 箇所が多いと漏れやミスが発生する |
| ts_codemod | AST パターンマッチング。括弧の対応を正確に認識 |

## ts_codemod の基本

### パターン構文

- `:[name]` - 任意の式・文にマッチするプレースホルダー（括弧のバランスを保持）
- 改行・インデントは実際のコードに合わせる

### 基本的な使い方

```typescript
// 1. まず dry_run: true でマッチ数を確認
ts_codemod({
  source: "oldPattern(:[args])",
  target: "newPattern(:[args])",
  path: "/path/to/file.ts",
  dry_run: true  // デフォルト
})

// 2. 確認後、dry_run: false で適用
ts_codemod({
  source: "oldPattern(:[args])",
  target: "newPattern(:[args])",
  path: "/path/to/file.ts",
  dry_run: false
})
```

## 実践例: 関数シグネチャの変更

### Before
```typescript
handler.execute({
  rawParams: { id: "task-1" },
  context: planContext,
})
```

### After
```typescript
handler.execute(
  { id: "task-1" },
  planContext
)
```

### ts_codemod パターン

```typescript
ts_codemod({
  source: `.execute({
          rawParams: :[params],
          context: :[ctx],
        })`,
  target: `.execute(
          :[params],
          :[ctx]
        )`,
  path: "/path/to/tests",
  dry_run: false
})
```

**重要**: インデントは実際のファイルと正確に一致させる（上記は8スペースインデント）。

## 使用判断基準

| 状況 | 推奨手法 |
|------|----------|
| 1-2箇所の変更 | Edit ツール |
| 3箇所以上の同一パターン | ts_codemod |
| 複雑な条件分岐を含む変更 | ts_codemod + 手動確認 |
| 単純な文字列置換（非コード） | Edit with replace_all |

## チェックリスト

- [ ] 変更パターンが3箇所以上あるか確認
- [ ] dry_run: true で想定通りのマッチ数か確認
- [ ] インデントが実際のファイルと一致しているか確認
- [ ] 適用後にテストを実行して検証
