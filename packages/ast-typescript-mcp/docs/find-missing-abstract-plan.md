# find_missing_abstract ツール設計

## 概要

サブクラスに存在するがベースクラスにないメソッドを検出。
ポリモーフィズム候補（抽象メソッド化すべきメソッド）を発見する。

## ユースケース

1. **ポリモーフィズムリファクタリング**: instanceof 違反の修正時
2. **インターフェース抽出**: 共通メソッドの発見
3. **設計レビュー**: クラス階層の整合性チェック

## インターフェース

```typescript
find_missing_abstract({
  // ベースクラスの指定
  baseClass: string,         // クラス名
  file: string,              // ベースクラスのファイルパス

  // オプション
  includePrivate?: boolean,  // private メソッドも含める (default: false)
})
```

## 出力形式

```typescript
interface FindMissingAbstractResult {
  baseClass: string;
  subclasses: Array<{
    name: string;
    file: string;
    methods: Array<{
      name: string;
      signature: string;      // メソッドシグネチャ
      line: number;
      // 他のサブクラスでの実装状況
      implementedIn: string[];   // 実装しているサブクラス名
      missingIn: string[];       // 実装していないサブクラス名
    }>;
  }>;

  // 全サブクラスに共通するメソッド → 抽象化の候補
  commonMethods: Array<{
    name: string;
    signature: string;
    implementedInAll: boolean;
  }>;
}
```

## 例

```
BaseHandler
├── MarkdownHandler
│   ├── read()           ← BaseHandler にある
│   ├── query()          ← BaseHandler にない！
│   └── goToDefinition() ← BaseHandler にない！
└── AsciidocHandler
    ├── read()           ← BaseHandler にある
    └── query()          ← BaseHandler にない！（両方にある → 候補）
```

出力:
```json
{
  "baseClass": "BaseHandler",
  "commonMethods": [
    {
      "name": "query",
      "signature": "query(params: {...}): Promise<QueryResult>",
      "implementedInAll": true   // 両サブクラスにある → 抽象化すべき
    }
  ],
  "subclasses": [
    {
      "name": "MarkdownHandler",
      "methods": [
        { "name": "goToDefinition", "missingIn": ["AsciidocHandler"] }
      ]
    }
  ]
}
```

## 実装方針

1. **ベースクラスのメソッド取得**: ts-morph で getMembers()
2. **サブクラス検出**: `extends BaseClass` を検索
3. **差分計算**: サブクラスのメソッド - ベースのメソッド
4. **共通メソッド検出**: 全サブクラスの積集合

## 実装ステップ

1. [ ] ベースクラスの解析
2. [ ] サブクラスの自動検出 (extends 検索)
3. [ ] メソッド差分計算
4. [ ] 共通メソッドの判定
5. [ ] テスト追加

## query_ast との連携

```
1. query_ast で instanceof パターンを検出
2. find_missing_abstract でベースに追加すべきメソッドを特定
3. (将来) add_abstract_method で自動追加
```

---

## レビューフィードバック (2026-02-23)

### 追加すべきパラメータ

```typescript
find_missing_abstract({
  baseClass: string,
  file: string,
  includePrivate?: boolean,
  // 追加
  includeProtected?: boolean,
  searchScope?: string,                         // サブクラス検索スコープ
  signatureMatching?: "exact" | "compatible",   // シグネチャ比較方法
})
```

### 出力形式の改善

```typescript
interface FindMissingAbstractResult {
  // 追加
  baseClassFile: string;
  baseMethods: MethodInfo[];

  commonMethods: Array<{
    name: string;
    signature: string;
    implementedInAll: boolean;
    // 追加: シグネチャ差異の可視化
    signatures: Array<{
      className: string;
      signature: string;
    }>;
    suggestedSignature?: string;
  }>;

  // 追加: AIの次アクション支援
  recommendations: Array<{
    action: "add_abstract" | "add_default" | "investigate";
    methodName: string;
    reason: string;
  }>;
}
```

### 追加考慮事項

- インターフェースの扱い（class/interface/both）
- ジェネリクスの処理
- mixinパターン対応
- 循環参照の検出

### 追加実装ステップ

6. [ ] ジェネリクスの処理
7. [ ] mixinパターン対応
8. [ ] 循環参照の検出と警告
9. [ ] searchScope実装
