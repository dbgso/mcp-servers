import { createTwoFilesPatch } from "diff";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const DIFF_DIR = path.join(os.tmpdir(), "mcp-instruction-diffs");

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
}): Promise<string> {
  const { diff, id } = params;

  await fs.mkdir(DIFF_DIR, { recursive: true });

  // Sanitize id for filename
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = Date.now();
  const filename = `${safeId}_${timestamp}.diff`;
  const filePath = path.join(DIFF_DIR, filename);

  await fs.writeFile(filePath, diff, "utf-8");

  return filePath;
}
