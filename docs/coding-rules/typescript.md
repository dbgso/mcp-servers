# TypeScript コーディング規約

このプロジェクト固有のTypeScriptコーディング規約。

## 関数の引数パターン (single-params-object)

**複数の引数を持つ関数は、単一のparamsオブジェクトを使用すること。**

ESLint `custom/single-params-object` ルールで検証される。

### ❌ Bad

```typescript
function createUser(name: string, age: number, email: string) {
  // ...
}

async function sendMessage(to: string, subject: string, body: string) {
  // ...
}

const calculate = (a: number, b: number) => a + b;
```

### ✅ Good

```typescript
function createUser(params: { name: string; age: number; email: string }) {
  const { name, age, email } = params;
  // ...
}

async function sendMessage(params: {
  to: string;
  subject: string;
  body: string;
}) {
  const { to, subject, body } = params;
  // ...
}

// 単一引数はそのままでOK
function greet(name: string) {
  return `Hello, ${name}`;
}

// 引数なしもOK
function getTimestamp() {
  return Date.now();
}
```

### 理由

1. **可読性**: 引数の意味が明確になる
2. **拡張性**: 新しい引数を追加しても呼び出し側の変更が最小限
3. **順序非依存**: 引数の順序を覚える必要がない
4. **オプショナル引数**: デフォルト値の設定が容易

### 例外

- コンストラクタは除外（`ignoreConstructors: true`）
- テストファイルは除外

## 型定義

### 明示的な型を使用

```typescript
// ❌ Bad
const data: any = fetchData();

// ✅ Good
const data: UserResponse = fetchData();
```

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
