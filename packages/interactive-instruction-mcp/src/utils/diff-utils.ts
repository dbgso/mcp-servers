import { createTwoFilesPatch } from "diff";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { scopedStateDir } from "../services/instance-scope.js";

// Overridable via env so parallel test workers can each get an isolated store.
const DIFF_BASE = "mcp-instruction-diffs";

function diffDir(docsDir: string): string {
  return scopedStateDir({
    base: DIFF_BASE,
    docsDir,
    override: process.env.MCP_INSTRUCTION_DIFF_DIR,
  });
}

export interface DiffOptions {
  /** Original file name for header */
  originalName?: string;
  /** New file name for header */
  newName?: string;
  /** Number of context lines around changes */
  contextLines?: number;
}

/**
 * Generate unified diff between two strings.
 * Returns empty string if no differences.
 */
export function generateDiff(params: {
  original: string;
  updated: string;
  options?: DiffOptions;
}): string {
  const { original, updated, options = {} } = params;
  const {
    originalName = "original",
    newName = "draft",
    contextLines = 3,
  } = options;

  // No diff if content is identical
  if (original === updated) {
    return "";
  }

  const patch = createTwoFilesPatch(
    originalName,
    newName,
    original,
    updated,
    undefined,
    undefined,
    { context: contextLines }
  );

  return patch;
}

/**
 * Format diff output for display in tool response.
 * Adds markdown code block with diff syntax highlighting.
 */
export function formatDiffForDisplay(diff: string): string {
  if (!diff) {
    return "";
  }

  return `\n\`\`\`diff\n${diff}\`\`\``;
}

/**
 * Write diff to a temporary file.
 * Returns the file path.
 */
export async function writeDiffToFile(params: {
  diff: string;
  id: string;
  docsDir: string;
}): Promise<string> {
  const { diff, id, docsDir } = params;

  const dir = diffDir(docsDir);
  await fs.mkdir(dir, { recursive: true });

  // Percent-encoded rather than character-replaced, so two ids cannot share a
  // name, plus a random suffix: the name used to be `${safeId}_${Date.now()}`,
  // and two updates within the same millisecond overwrote each other's diff.
  const suffix = crypto.randomBytes(4).toString("hex");
  const filename = `${encodeURIComponent(id)}_${Date.now()}_${suffix}.diff`;
  const filePath = path.join(dir, filename);

  await fs.writeFile(filePath, diff, "utf-8");

  return filePath;
}

/**
 * Remove a diff file, if it is still there. Cleanup is best-effort by design:
 * a missing diff is not a reason to fail the operation that owns it.
 */
export async function removeDiffFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // Already gone.
  }
}
