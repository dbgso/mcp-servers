import { errorResponse, jsonResponse } from "./mcp-response.js";

/**
 * Result of processing a single file
 */
export interface FileResult<T> {
  filePath: string;
  result?: T;
  error?: string;
}

/**
 * Process multiple files in parallel
 */
export async function processMultipleFiles<T>(
  filePaths: string[],
  processor: (filePath: string) => Promise<FileResult<T>>
): Promise<FileResult<T>[]> {
  return Promise.all(filePaths.map(processor));
}

/**
 * Format results from multiple file processing into MCP response
 */
export function formatMultiFileResponse<T>(results: FileResult<T>[]) {
  if (results.length === 1) {
    const r = results[0];
    if (r.error) {
      return errorResponse(`Failed to read file: ${r.error}`);
    }
    return jsonResponse(r.result);
  }

  const output = results.map((r) => {
    if (r.error) {
      return { filePath: r.filePath, error: r.error };
    }
    return r.result;
  });

  return jsonResponse(output);
}
