---
description: Solution for TypeScript OOM crashes when using Zod schemas with generics
whenToUse:
  - Using Zod schemas with TypeScript generics
  - Debugging TypeScript OOM or slow compilation
  - Designing base classes that use Zod for validation
---

# Zod Generics と TypeScript コンパイル OOM 問題

zod のスキーマ型をジェネリクス引数として使うと TypeScript コンパイルが OOM でクラッシュする問題と、その解決策。

## 問題

`BaseToolHandler<typeof zodSchema>` のように zod スキーマ型をジェネリクス引数として渡すと、TypeScript コンパイルが極端に遅くなり、OOM（メモリ不足）でクラッシュする。

## 原因

- `z.ZodType` は複雑な再帰的条件型
- `typeof z.object({...})` を型引数に渡すと、TypeScript が zod の型システム全体を解析しようとする
- 複数ファイルで同じパターンを使うと、型解決が爆発的に増加
- 例: 12 ハンドラファイル × 複雑な型解決 = OOM

## 悪い例（遅い）

```typescript
// mcp-shared
export abstract class BaseToolHandler<TSchema extends z.ZodType> {
  abstract readonly schema: TSchema;
  protected abstract doExecute(args: z.infer<TSchema>): Promise<ToolResponse>;
}

// アプリ側
const MySchema = z.object({ name: z.string() });
class MyHandler extends BaseToolHandler<typeof MySchema> {  // ← 遅い！
  // ...
}
```

## 良い例（速い）

```typescript
// mcp-shared - zodの型を触らない
export interface ZodLikeSchema<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export abstract class BaseToolHandler<TArgs = unknown> {
  abstract readonly schema: ZodLikeSchema<TArgs>;  // 型消去
  protected abstract doExecute(args: TArgs): Promise<ToolResponse>;
}

// アプリ側 - z.inferは1回だけ
const MySchema = z.object({ name: z.string() });
type MyArgs = z.infer<typeof MySchema>;  // ここで1回だけ解決

class MyHandler extends BaseToolHandler<MyArgs> {  // ← 速い！
  readonly schema = MySchema;
  protected async doExecute(args: MyArgs): Promise<ToolResponse> {
    // args.name は string 型として認識される
  }
}
```

## ポイント

1. **共有ライブラリでは zod の型を直接使わない** - `z.ZodType` 制約を避ける
2. **`ZodLikeSchema<T>` で型消去** - ランタイム検証に必要な `safeParse` メソッドのみ定義
3. **`z.infer` はアプリ側で使う** - 各ファイルで `type XxxArgs = z.infer<typeof XxxSchema>` を定義
4. **ジェネリクスには推論済みの型を渡す** - `BaseToolHandler<MyArgs>` のように
