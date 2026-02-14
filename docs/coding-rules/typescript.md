# TypeScript コーディング規約

このプロジェクト固有のTypeScriptコーディング規約。

## 型定義

### インターフェース命名

```typescript
// ❌ Bad - Iプレフィックス不要
interface IUser { }

// ✅ Good
interface User { }
interface UserParams { }
```

### 型エイリアス vs インターフェース

```typescript
// オブジェクト型はインターフェース
interface User {
  id: string;
  name: string;
}

// ユニオン型や複合型は型エイリアス
type Status = 'pending' | 'active' | 'completed';
type Result<T> = { success: true; data: T } | { success: false; error: string };
```

## import/export

### 名前付きエクスポートを優先

```typescript
// ❌ Bad
export default class UserService { }

// ✅ Good
export class UserService { }
export function createUser(params: CreateUserParams) { }
```

### 型インポートを明示

```typescript
// ❌ Bad
import { User, createUser } from './user';

// ✅ Good - 型は type キーワードで明示
import type { User } from './user';
import { createUser } from './user';

// または
import { type User, createUser } from './user';
```

## 非同期処理

### async/await を優先

```typescript
// ❌ Bad
function fetchUser(id: string) {
  return fetch(`/users/${id}`)
    .then(res => res.json())
    .then(data => data.user);
}

// ✅ Good
async function fetchUser(params: { id: string }) {
  const res = await fetch(`/users/${params.id}`);
  const data = await res.json();
  return data.user;
}
```

### エラーハンドリング

```typescript
// Result型パターンを推奨
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function fetchUser(params: { id: string }): Promise<Result<User>> {
  try {
    const res = await fetch(`/users/${params.id}`);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
```

## テスト

### test.each を使用

テストケースは `test.each` / `it.each` で記述し、テストデータは型付きの変数に抽出する。

```typescript
// ❌ Bad - 個別のテスト
it('should parse "hello"', () => {
  expect(parse('hello')).toBe('hello');
});

it('should parse "world"', () => {
  expect(parse('world')).toBe('world');
});

// ❌ Bad - インライン配列、型なし
it.each([
  ['hello', 'hello'],
  ['world', 'world'],
])('should parse %s', (input, expected) => {
  expect(parse(input)).toBe(expected);
});

// ✅ Good - 型付き変数 + test.each
type ParseTestCase = {
  input: string;
  expected: string;
};

const parseTestCases: ParseTestCase[] = [
  { input: 'hello', expected: 'hello' },
  { input: 'world', expected: 'world' },
];

it.each(parseTestCases)('should parse "$input"', ({ input, expected }) => {
  expect(parse(input)).toBe(expected);
});
```

### 理由

1. **型安全**: テストデータの構造が明確
2. **保守性**: ケース追加が容易
3. **可読性**: テストの意図が明確
