import type { GitOperation } from "./types.js";
import { grepOperations } from "./grep-ops.js";
import { lsFilesOperations } from "./ls-files-ops.js";
import { logOperations } from "./log-ops.js";
import { blameOperations } from "./blame-ops.js";
import { showOperations } from "./show-ops.js";
import { diffOperations } from "./diff-ops.js";
import { branchOperations } from "./branch-ops.js";
import { tagOperations } from "./tag-ops.js";

/** All registered git operations */
export const allOperations: GitOperation[] = [
  ...grepOperations,
  ...lsFilesOperations,
  ...logOperations,
  ...blameOperations,
  ...showOperations,
  ...diffOperations,
  ...branchOperations,
  ...tagOperations,
];

/** Lookup map for O(1) access */
const operationMap = new Map<string, GitOperation>(
  allOperations.map(op => [op.id, op]),
);

/** Find an operation by ID */
export function getOperation(id: string): GitOperation | undefined {
  return operationMap.get(id);
}

/** Get all unique categories */
export function getCategories(): string[] {
  return [...new Set(allOperations.map(op => op.category))];
}

/** Group operations by category */
export function getOperationsByCategory(): Record<string, GitOperation[]> {
  const grouped: Record<string, GitOperation[]> = {};
  for (const op of allOperations) {
    if (!grouped[op.category]) grouped[op.category] = [];
    grouped[op.category]!.push(op);
  }
  return grouped;
}
