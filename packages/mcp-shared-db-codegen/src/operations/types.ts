/**
 * Codegen operation context. Operations only see the introspector — they
 * never need DB credentials directly.
 */
import type { Operation } from "mcp-shared";
import type { Introspector } from "../introspect/types.js";

export interface CodegenOperationContext {
  introspector: Introspector;
}

export type CodegenOperation<TArgs = unknown> = Operation<TArgs, CodegenOperationContext>;
