/**
 * Precondition Validators for Workflow State Machine
 *
 * These validators implement the Strategy pattern for checking
 * preconditions before workflow state transitions.
 */

import type { PreconditionValidator } from "../types/workflow.js";

/**
 * Validator: Field is required (not null, not undefined, not empty string)
 *
 * @param field - The context field to check
 * @returns A validator that fails if the field is null, undefined, or empty string
 *
 * @example
 * ```typescript
 * const validator = fieldRequired<{ name: string }>("name");
 * validator.validate({ name: "John" }, {}); // true
 * validator.validate({ name: "" }, {}); // false
 * ```
 */
class FieldRequired<TContext, TParams>
  implements PreconditionValidator<TContext, TParams>
{
  constructor(private readonly field: keyof TContext) {}

  validate(ctx: TContext): boolean {
    const value = ctx[this.field];
    return value != null && value !== "";
  }

  getMessage(): string {
    return `Field "${String(this.field)}" is required`;
  }
}

export function fieldRequired<TContext, TParams = unknown>(
  field: keyof TContext
): PreconditionValidator<TContext, TParams> {
  return new FieldRequired<TContext, TParams>(field);
}

/**
 * Validator: Field has minimum length
 *
 * Works with strings (character count) and arrays (item count).
 *
 * @param params.field - The context field to check
 * @param params.min - The minimum length required
 * @returns A validator that fails if the field length is below minimum
 *
 * @example
 * ```typescript
 * const validator = fieldMinLength<{ tags: string[] }>({ field: "tags", min: 2 });
 * validator.validate({ tags: ["a", "b"] }, {}); // true
 * validator.validate({ tags: ["a"] }, {}); // false
 * ```
 */
class FieldMinLength<TContext, TParams>
  implements PreconditionValidator<TContext, TParams>
{
  constructor(
    private readonly options: { field: keyof TContext; min: number }
  ) {}

  validate(ctx: TContext): boolean {
    const { field, min } = this.options;
    const value = ctx[field];
    if (typeof value === "string") {
      return value.length >= min;
    }
    if (Array.isArray(value)) {
      return value.length >= min;
    }
    return false;
  }

  getMessage(): string {
    const { field, min } = this.options;
    return `Field "${String(field)}" must have at least ${min} characters/items`;
  }
}

export function fieldMinLength<TContext, TParams = unknown>(params: {
  field: keyof TContext;
  min: number;
}): PreconditionValidator<TContext, TParams> {
  return new FieldMinLength<TContext, TParams>(params);
}

/**
 * Validator: A specific state has been visited
 *
 * Checks if the workflow has previously visited a specific state.
 * The visited states are injected into context as `_visitedStates` by the workflow engine.
 *
 * @param state - The state name that must have been visited
 * @returns A validator that fails if the state has not been visited
 *
 * @example
 * ```typescript
 * const validator = stateVisited("review");
 * // Fails until "review" state has been visited
 * ```
 */
class StateVisited<TContext, TParams>
  implements PreconditionValidator<TContext, TParams>
{
  constructor(private readonly state: string) {}

  validate(ctx: TContext): boolean {
    // _visitedStates is injected by the workflow engine at runtime
    const visited = (ctx as TContext & { _visitedStates?: string[] })._visitedStates ?? [];
    return visited.includes(this.state);
  }

  getMessage(): string {
    return `State "${this.state}" must have been visited`;
  }
}

export function stateVisited<TContext, TParams = unknown>(
  state: string
): PreconditionValidator<TContext, TParams> {
  return new StateVisited<TContext, TParams>(state);
}

/**
 * Validator: Custom validation function
 *
 * Allows defining arbitrary validation logic with a custom error message.
 *
 * @param params.check - Function that returns true if validation passes
 * @param params.message - Error message to display if validation fails
 * @returns A validator using the custom check function
 *
 * @example
 * ```typescript
 * const validator = customValidator<{ count: number }, { action: string }>({
 *   check: (ctx, params) => ctx.count > 0 && params.action === "submit",
 *   message: "Count must be positive and action must be submit",
 * });
 * ```
 */
class CustomValidator<TContext, TParams>
  implements PreconditionValidator<TContext, TParams>
{
  /** The caller's own predicate, held as-is so it keeps its two arguments. */
  readonly validate: (ctx: TContext, params: TParams) => boolean;

  private readonly message: string;

  constructor(options: {
    check: (ctx: TContext, params: TParams) => boolean;
    message: string;
  }) {
    this.validate = options.check;
    this.message = options.message;
  }

  getMessage(): string {
    return this.message;
  }
}

export function customValidator<TContext, TParams = unknown>(params: {
  check: (ctx: TContext, params: TParams) => boolean;
  message: string;
}): PreconditionValidator<TContext, TParams> {
  return new CustomValidator<TContext, TParams>(params);
}
