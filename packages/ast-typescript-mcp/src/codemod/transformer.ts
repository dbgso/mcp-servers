/**
 * File transformer for codemod operations.
 *
 * Handles finding files and applying transformations.
 */

import { readFile, writeFile } from "node:fs/promises";
import { glob } from "glob";
import { transform } from "./pattern-matcher.js";

export interface FileChange {
  file: string;
  line: number;
  column: number;
  before: string;
  after: string;
}

export interface TransformResult {
  totalMatches: number;
  filesModified: string[];
  changes: FileChange[];
  dryRun: boolean;
}

export interface TransformParams {
  sourcePattern: string;
  targetPattern: string;
  path: string;
  filePattern?: string;
  dryRun?: boolean;
}

/**
 * Find all TypeScript files matching the path/pattern.
 */
async function findFiles(params: {
  path: string;
  filePattern?: string;
}): Promise<string[]> {
  const { path, filePattern } = params;

  // Check if path is a file or directory
  const pattern = filePattern
    ? `${path}/${filePattern}`
    : path.endsWith(".ts") || path.endsWith(".tsx")
      ? path
      : `${path}/**/*.{ts,tsx}`;

  const files = await glob(pattern, {
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
    absolute: true,
  });

  return files;
}

/**
 * Get line and column from offset in source.
 */
function getLineAndColumn(params: {
  source: string;
  offset: number;
}): { line: number; column: number } {
  const { source, offset } = params;
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Transform files matching the pattern.
 */
export async function transformFiles(params: TransformParams): Promise<TransformResult> {
  const {
    sourcePattern,
    targetPattern,
    path,
    filePattern,
    dryRun = true,
  } = params;

  const files = await findFiles({ path, filePattern });
  const allChanges: FileChange[] = [];
  const filesModified: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf-8");
    const { result, changes } = transform({
      source,
      sourcePattern,
      targetPattern,
    });

    if (changes.length > 0) {
      filesModified.push(file);

      for (const change of changes) {
        const { line, column } = getLineAndColumn({
          source,
          offset: change.start,
        });

        allChanges.push({
          file,
          line,
          column,
          before: change.before,
          after: change.after,
        });
      }

      if (!dryRun) {
        await writeFile(file, result, "utf-8");
      }
    }
  }

  return {
    totalMatches: allChanges.length,
    filesModified,
    changes: allChanges,
    dryRun,
  };
}
