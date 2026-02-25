---
whenToUse:
  - Writing conditional logic
  - Refactoring nested if-else statements
  - Implementing guard clauses
  - Reviewing code with deep nesting
---

# Early Return パターン

条件分岐では `let` や三項演算子ではなく、メソッド・関数の早期returnを使用するルール。

## 悪い例

```typescript
// ❌ let + if-else
let result: string;
if (condition) {
  result = "value1";
} else {
  result = "value2";
}
return result;

// ❌ 三項演算子（複雑な場合）
const result = condition1
  ? value1
  : condition2
    ? value2
    : value3;
```

## 良い例

```typescript
// ✅ 早期return
function getValue(condition: boolean): string {
  if (condition) {
    return "value1";
  }
  return "value2";
}

// ✅ ガード節
async function validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
  if (!this.allowedTransitions.includes(ctx.newStatus)) {
    return {
      allowed: false,
      error: `Cannot transition...`,
    };
  }

  if (!ctx.params.comment) {
    return {
      allowed: false,
      error: `Feedback required...`,
    };
  }

  return { allowed: true };
}
```

## 理由

- コードの読みやすさが向上（ネストが浅くなる）
- 各条件の処理が明確に分離される
- `let` による変数の再代入を避けられる
