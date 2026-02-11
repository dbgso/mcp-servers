import type { Operation } from "./types.js";
import { queryOperations } from "./query-ops.js";
import { mutateOperations } from "./mutate-ops.js";

export const allQueryOperations: Operation[] = queryOperations;
export const allMutateOperations: Operation[] = mutateOperations;
export const allOperations: Operation[] = [...queryOperations, ...mutateOperations];

const queryMap = new Map<string, Operation>(
  queryOperations.map(op => [op.id, op]),
);

const mutateMap = new Map<string, Operation>(
  mutateOperations.map(op => [op.id, op]),
);

export function getQueryOperation(id: string): Operation | undefined {
  return queryMap.get(id);
}

export function getMutateOperation(id: string): Operation | undefined {
  return mutateMap.get(id);
}

export function getOperation(id: string): Operation | undefined {
  return queryMap.get(id) ?? mutateMap.get(id);
}
