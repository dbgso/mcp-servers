---
whenToUse:
  - Writing TypeScript code
  - Using Zod schemas
  - Defining types and interfaces
  - Writing async functions
  - Creating test cases with test.each
---

# TypeScript Coding Standards

TypeScript coding standards specific to this project.

## Zod

### z.infer vs z.input

- `z.infer<T>` / `z.output<T>`: Output type after parsing (after defaults applied)
- `z.input<T>`: Input type before parsing (before defaults applied)

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number().optional().default(0),
});

// z.input: { name: string; age?: number | undefined }
// z.infer: { name: string; age: number }

// ❌ Bad - Using without considering the purpose
type Args = z.infer<typeof schema>;

// ✅ Good - Use appropriately based on purpose
type InputArgs = z.input<typeof schema>;   // Before validation
type OutputArgs = z.infer<typeof schema>;  // After validation
```

### Usage in Operation Types

```typescript
// Define schema first
const argsSchema = z.object({
  id: z.string(),
  limit: z.number().optional(),  // Avoid .default()
});

// Use the parsed type (type that execute receives)
type Args = z.infer<typeof argsSchema>;

export const op: Operation<Args> = {
  argsSchema,
  execute: async (args, ctx) => {
    // args.limit is number | undefined
    const limit = args.limit ?? 10;  // Apply default here
  },
};
```

## Type Definitions

### Interface Naming

```typescript
// ❌ Bad - I prefix unnecessary
interface IUser { }

// ✅ Good
interface User { }
interface UserParams { }
```

### Type Alias vs Interface

```typescript
// Use interface for object types
interface User {
  id: string;
  name: string;
}

// Use type alias for union types and complex types
type Status = 'pending' | 'active' | 'completed';
type Result<T> = { success: true; data: T } | { success: false; error: string };
```

## import/export

### Prefer Named Exports

```typescript
// ❌ Bad
export default class UserService { }

// ✅ Good
export class UserService { }
export function createUser(params: CreateUserParams) { }
```

### Make Type Imports Explicit

```typescript
// ❌ Bad
import { User, createUser } from './user';

// ✅ Good - Make types explicit with type keyword
import type { User } from './user';
import { createUser } from './user';

// Or
import { type User, createUser } from './user';
```

## Async Processing

### Prefer async/await

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

### Error Handling

```typescript
// Result type pattern is recommended
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

## Testing

### Use test.each

Write test cases with `test.each` / `it.each`, and extract test data into typed variables.

```typescript
// ❌ Bad - Individual tests
it('should parse "hello"', () => {
  expect(parse('hello')).toBe('hello');
});

it('should parse "world"', () => {
  expect(parse('world')).toBe('world');
});

// ❌ Bad - Inline array, no types
it.each([
  ['hello', 'hello'],
  ['world', 'world'],
])('should parse %s', (input, expected) => {
  expect(parse(input)).toBe(expected);
});

// ✅ Good - Typed variable + test.each
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

### Rationale

1. **Type safety**: Test data structure is clear
2. **Maintainability**: Easy to add cases
3. **Readability**: Test intent is clear
