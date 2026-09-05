import { createOperationRegistry, type Operation, type OperationRegistry } from "mcp-shared";
import { manageOperations } from "./manage-ops.js";
import type { WaitContext } from "./types.js";
import { waitOperations } from "./wait-ops.js";

export const allOperations: Operation<unknown, WaitContext>[] = [
  ...waitOperations,
  ...manageOperations,
];

export function createWaitOperationRegistry(): OperationRegistry<WaitContext> {
  return createOperationRegistry<WaitContext>(allOperations);
}
