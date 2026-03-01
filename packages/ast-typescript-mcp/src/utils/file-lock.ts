/**
 * Simple in-memory file lock registry for detecting concurrent modifications.
 *
 * This prevents multiple tool invocations from modifying the same file in parallel,
 * which can cause line number shifts and "Debug Failure" errors in ts-morph.
 */

interface LockInfo {
  toolName: string;
  lockedAt: number;
  line?: number;
}

const fileLocks = new Map<string, LockInfo>();

export interface AcquireLockResult {
  success: boolean;
  error?: string;
}

/**
 * Attempt to acquire a lock on a file for modification.
 *
 * @returns success=true if lock acquired, success=false with error message if file is already locked
 */
export function acquireFileLock(params: {
  filePath: string;
  toolName: string;
  line?: number;
}): AcquireLockResult {
  const { filePath, toolName, line } = params;
  const existing = fileLocks.get(filePath);

  if (existing) {
    const elapsed = Date.now() - existing.lockedAt;
    // Auto-release stale locks (> 30 seconds)
    if (elapsed > 30000) {
      fileLocks.delete(filePath);
    } else {
      const lineInfo = existing.line ? ` at line ${existing.line}` : "";
      return {
        success: false,
        error: `File "${filePath}" is currently being modified by ${existing.toolName}${lineInfo}. ` +
          `Parallel modifications to the same file cause line number shifts and errors. ` +
          `Use batch_execute for multiple operations on the same file, or wait for the current operation to complete.`,
      };
    }
  }

  fileLocks.set(filePath, {
    toolName,
    lockedAt: Date.now(),
    line,
  });

  return { success: true };
}

/**
 * Release a file lock after modification is complete.
 */
export function releaseFileLock(params: { filePath: string }): void {
  const { filePath } = params;
  fileLocks.delete(filePath);
}

/**
 * Check if a file is currently locked without acquiring.
 */
export function isFileLocked(params: { filePath: string }): boolean {
  const { filePath } = params;
  const existing = fileLocks.get(filePath);
  if (!existing) return false;

  const elapsed = Date.now() - existing.lockedAt;
  if (elapsed > 30000) {
    fileLocks.delete(filePath);
    return false;
  }

  return true;
}

/**
 * Clear all locks (for testing purposes).
 */
export function clearAllLocks(): void {
  fileLocks.clear();
}
