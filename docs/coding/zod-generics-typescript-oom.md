---
description: Solution for TypeScript OOM crashes when using Zod schemas with generics
whenToUse:
  - Using Zod schemas with TypeScript generics
  - Debugging TypeScript OOM or slow compilation
  - Designing base classes that use Zod for validation
---

# Zod Generics and TypeScript Compilation OOM Issue

This document describes the problem where TypeScript compilation crashes with OOM when using Zod schema types as generic arguments, along with its solution.

## Problem

When passing Zod schema types as generic arguments like `BaseToolHandler<typeof zodSchema>`, TypeScript compilation becomes extremely slow and crashes with OOM (Out of Memory).

## Cause

- `z.ZodType` is a complex recursive conditional type
- When `typeof z.object({...})` is passed as a type argument, TypeScript tries to analyze the entire Zod type system
- When the same pattern is used across multiple files, type resolution increases explosively
- Example: 12 handler files × complex type resolution = OOM

## Bad Example (Slow)

```typescript
// mcp-shared
export abstract class BaseToolHandler<TSchema extends z.ZodType> {
  abstract readonly schema: TSchema;
  protected abstract doExecute(args: z.infer<TSchema>): Promise<ToolResponse>;
}

// Application side
const MySchema = z.object({ name: z.string() });
class MyHandler extends BaseToolHandler<typeof MySchema> {  // ← Slow!
  // ...
}
```

## Good Example (Fast)

```typescript
// mcp-shared - Don't touch Zod types
export interface ZodLikeSchema<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export abstract class BaseToolHandler<TArgs = unknown> {
  abstract readonly schema: ZodLikeSchema<TArgs>;  // Type erasure
  protected abstract doExecute(args: TArgs): Promise<ToolResponse>;
}

// Application side - z.infer only once
const MySchema = z.object({ name: z.string() });
type MyArgs = z.infer<typeof MySchema>;  // Resolve only once here

class MyHandler extends BaseToolHandler<MyArgs> {  // ← Fast!
  readonly schema = MySchema;
  protected async doExecute(args: MyArgs): Promise<ToolResponse> {
    // args.name is recognized as string type
  }
}
```

## Key Points

1. **Don't use Zod types directly in shared libraries** - Avoid `z.ZodType` constraints
2. **Use `ZodLikeSchema<T>` for type erasure** - Define only the `safeParse` method needed for runtime validation
3. **Use `z.infer` on the application side** - Define `type XxxArgs = z.infer<typeof XxxSchema>` in each file
4. **Pass already-inferred types to generics** - Like `BaseToolHandler<MyArgs>`
