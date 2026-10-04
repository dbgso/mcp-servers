import { extname } from "node:path";
import { MarkdownHandler } from "./markdown.js";
import { AsciidocHandler } from "./asciidoc.js";
import type { DocumentType } from "./anchor.js";
import type { FileSummary } from "../types/index.js";

export type DocumentHandler = MarkdownHandler | AsciidocHandler;

/** The one handler of each document type; tools look handlers up here rather than constructing their own. */
export const HANDLERS: Record<DocumentType, DocumentHandler> = {
  markdown: new MarkdownHandler(),
  asciidoc: new AsciidocHandler(),
};

const handlers = Object.values(HANDLERS);

function handlerForExtension(ext: string): DocumentHandler | undefined {
  return handlers.find((h) => h.extensions.includes(ext.toLowerCase()));
}

export function getHandler(filePath: string): DocumentHandler | undefined {
  return handlerForExtension(extname(filePath).slice(1));
}

export function getSupportedExtensions(): string[] {
  return handlers.flatMap((h) => h.extensions);
}

export type DocumentsRead =
  | { files: FileSummary[]; errors: Array<{ filePath: string; error: string }> }
  | { error: string };

/**
 * Every document under `directory`: of the type `pattern` names (`*.md`,
 * `*.adoc`, ...), or of every type when there is no pattern, sorted by path.
 * A pattern no handler reads is an error.
 *
 * read_directory, topic_index and structure_analysis each chose the handler
 * from the pattern with their own if/else, and had drifted: one sorted, one did
 * not, one answered an unknown pattern with an empty result.
 */
export async function readDocuments(params: { directory: string; pattern?: string }): Promise<DocumentsRead> {
  const { directory, pattern } = params;
  const chosen = pattern ? handlerForExtension(pattern.replace("*.", "")) : undefined;
  if (pattern && !chosen) {
    return { error: `Unsupported file pattern: ${pattern}` };
  }

  const results = await Promise.all((chosen ? [chosen] : handlers).map((h) => h.readDirectory({ directory, pattern })));
  return {
    files: results.flatMap((r) => r.files).sort((a, b) => a.filePath.localeCompare(b.filePath)),
    errors: results.flatMap((r) => r.errors),
  };
}

export { MarkdownHandler, AsciidocHandler };
