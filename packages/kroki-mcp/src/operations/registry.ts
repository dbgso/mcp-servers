import type { Operation } from "./types.js";
import { describeOperation } from "./describe-ops.js";

/**
 * All registered operations
 */
export const allOperations: Operation<unknown>[] = [
  describeOperation as Operation<unknown>,
];

/**
 * Get operation by ID
 */
export function getOperation(id: string): Operation<unknown> | undefined {
  return allOperations.find(op => op.id === id);
}
