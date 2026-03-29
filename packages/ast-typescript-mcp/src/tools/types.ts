// Re-export from mcp-shared
export type { ToolHandler, ToolResponse, ToolDefinition } from "mcp-shared";

import type { Project, SourceFile } from "ts-morph";

/**
 * Context for batch execution of multiple AST transformations.
 * When provided, transformations share a single Project instance
 * and defer saving until the batch completes.
 */
export interface BatchContext {
  /** Shared ts-morph Project instance */
  project: Project;
  /** Source files that have been modified */
  modifiedFiles: Map<string, SourceFile>;
  /** Whether this is a preview run (no actual file writes) */
  dryRun: boolean;
  /** Accumulated changes for diff preview */
  changes: BatchChange[];
}

export interface BatchChange {
  filePath: string;
  line: number;
  description: string;
  before: string;
  after: string;
}

/**
 * Result of a single operation within a batch
 */
export interface BatchOperationResult {
  tool: string;
  filePath: string;
  success: boolean;
  change?: BatchChange;
  error?: string;
}
