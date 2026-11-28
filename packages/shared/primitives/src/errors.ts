/**
 * Runtime errors for the primitives layer.
 *
 * Spec: docs/specs/whitelist-abstraction.md (Trait access / Runtime errors).
 */

/**
 * Thrown by a `ToolContext` trait accessor when an op consumes a trait
 * the ctx does not declare. Carries the `tool` and `trait` names so the
 * failure identifies both the offending tool and the missing capability.
 *
 * Per spec, `ctx.trait(name)` MUST throw this (never return `undefined`)
 * for an undeclared trait; registry-load build-time tests are the first
 * line of defence and this is the runtime backstop.
 */
export class UnsupportedOperationError extends Error {
  readonly tool: string;
  readonly trait: string;

  constructor(input: { tool: string; trait: string }) {
    super(`Tool "${input.tool}" does not support the "${input.trait}" trait.`);
    this.name = "UnsupportedOperationError";
    this.tool = input.tool;
    this.trait = input.trait;
  }
}
