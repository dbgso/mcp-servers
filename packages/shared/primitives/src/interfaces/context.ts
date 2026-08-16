/**
 * ToolContext — how traits reach ops. Every registered op receives a
 * ctx whose shape is parameterised by (Core, Reader trait set, Extras
 * trait set). The `trait(name)` accessor throws
 * `UnsupportedOperationError` (see ../errors.ts) when the tool didn't
 * declare the trait.
 *
 * See docs/specs/whitelist-abstraction.md §6.
 */

import type { LimitPolicy } from "./limit-policy.js";
import type { Whitelist } from "./whitelist.js";

/**
 * `TExtras` is a `Record<traitName, TraitInstance | undefined>`. When
 * the value is undefined at ctx-creation time the tool didn't declare
 * that trait; `trait(name)` throws for such keys.
 */
export interface ToolContext<
  TCore extends Whitelist<string>,
  TReader = Record<string, never>,
  TExtras extends Record<string, unknown | undefined> = Record<string, unknown | undefined>,
> {
  readonly whitelist: TCore;
  readonly reader: TReader;
  readonly limit: LimitPolicy;
  readonly dryRun?: boolean;

  /**
   * Type-safe accessor. `NonNullable<TExtras[K]>` means the compiler
   * removes the `| undefined` from the return type — the runtime
   * check throws if the trait is missing, so downstream code sees a
   * non-null trait or an exception.
   */
  trait<K extends keyof TExtras>(name: K): NonNullable<TExtras[K]>;
}
