import { z } from "zod";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { getHandler, getSupportedExtensions, HANDLERS, type DocumentHandler } from "../../handlers/index.js";
import { headingAnchor, normalizeAnchor } from "../../handlers/anchor.js";
import { FileTarget, parseLinkTarget } from "../../handlers/links.js";
import type { Backlink, FindBacklinksResult, LinkSummary } from "../../types/index.js";

const FindBacklinksSchema = z.object({
  file_path: z.string().describe("Absolute path to the target file to find backlinks for"),
  section_heading: z
    .string()
    .optional()
    .describe("Optional: specific section heading to find backlinks to (filters to links with matching anchor)"),
  directory: z.string().describe("Directory to search for backlinks in (recursive)"),
  include_anchors: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include links with #anchor fragments (default: true). Set to false to only match file-level links."),
});

type FindBacklinksArgs = z.infer<typeof FindBacklinksSchema>;

/** A document extension at the end of a path, for every type a handler reads. */
const DOCUMENT_EXTENSION = new RegExp(`\\.(${getSupportedExtensions().join("|")})$`);

/** An Antora `module:page` names `page` within the same module. */
function withoutModule(pathPart: string): string {
  if (!pathPart.includes(":") || pathPart.startsWith(".")) return pathPart;
  return pathPart.slice(pathPart.lastIndexOf(":") + 1);
}

/**
 * The paths a link may mean, relative to the linking file: as written, with
 * `.adoc` added, and -- for a bare name with no directory part -- the name with
 * its extension swapped for `.adoc` or `.md` (`xref:data-flow[]`).
 */
function candidatePaths(path: string): string[] {
  const candidates = [path, `${path}.adoc`];
  if (/\/|\.\./.test(path)) return candidates;
  const bare = path.replace(DOCUMENT_EXTENSION, "");
  return [...candidates, `${bare}.adoc`, `${bare}.md`];
}

export class FindBacklinksHandler extends BaseToolHandler<FindBacklinksArgs> {
  readonly name = "find_backlinks";
  readonly schema = FindBacklinksSchema;
  readonly description =
    "Find all documents that reference a specific file or section (reverse reference map). Useful for impact analysis when modifying or deleting content.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the target file to find backlinks for",
      },
      section_heading: {
        type: "string",
        description:
          "Optional: specific section heading to find backlinks to (filters to links with matching anchor)",
      },
      directory: {
        type: "string",
        description: "Directory to search for backlinks in (recursive)",
      },
      include_anchors: {
        type: "boolean",
        description:
          "Include links with #anchor fragments (default: true). Set to false to only match file-level links.",
      },
    },
    required: ["file_path", "directory"],
  };

  protected async doExecute(args: FindBacklinksArgs): Promise<ToolResponse> {
    const { file_path, section_heading, directory, include_anchors } = args;

    // Normalize target file path
    const targetPath = resolve(file_path);

    // Check if target file exists
    if (!existsSync(targetPath)) {
      return errorResponse(`Target file not found: ${targetPath}`);
    }

    // Check if directory exists
    if (!existsSync(directory)) {
      return errorResponse(`Directory not found: ${directory}`);
    }

    // Every document in the directory, with the handler that reads it
    const handlers = Object.values(HANDLERS);
    const found = await Promise.all(handlers.map((handler) => handler.findFiles({ directory })));
    const sources = handlers
      .flatMap((handler, i) => found[i].map((sourceFile) => ({ sourceFile, handler })))
      .filter(({ sourceFile }) => resolve(sourceFile) !== targetPath); // Skip self-references

    // Generate expected anchor from section heading
    const expectedAnchor = section_heading
      ? headingAnchor({ text: section_heading, fileType: getHandler(targetPath)?.fileType ?? "markdown" })
      : null;

    const backlinks: Backlink[] = [];
    for (const source of sources) {
      backlinks.push(
        ...(await this.backlinksFrom({ ...source, targetPath, expectedAnchor, includeAnchors: include_anchors })),
      );
    }

    const result: FindBacklinksResult = {
      targetFile: targetPath,
      targetSection: section_heading,
      backlinks,
      summary: {
        totalBacklinks: backlinks.length,
        sourceFiles: new Set(backlinks.map((b) => b.sourceFile)).size,
      },
    };

    return jsonResponse(result);
  }

  /** The links in one source file that point at the target; none when it cannot be read. */
  private async backlinksFrom(params: {
    sourceFile: string;
    handler: DocumentHandler;
    targetPath: string;
    expectedAnchor: string | null;
    includeAnchors: boolean;
  }): Promise<Backlink[]> {
    const { sourceFile, handler, targetPath, expectedAnchor, includeAnchors } = params;
    try {
      const links = await handler.getLinksFromFile(sourceFile);
      const lines = (await readFile(sourceFile, "utf-8")).split("\n");
      return links
        .filter((link) => this.checkLinkMatchesTarget({ link, sourceFile, targetPath, expectedAnchor, includeAnchors }).matches)
        .map((link) => ({
          sourceFile,
          sourceLine: link.line,
          linkText: link.text,
          linkUrl: link.url,
          // ~50 chars before/after the link on the same line
          context: this.extractContext({ lines, line: link.line, linkText: link.text }),
        }));
    } catch {
      // Skip files that can't be read
      return [];
    }
  }

  /**
   * Check if a link matches the target file/section
   */
  private checkLinkMatchesTarget(params: {
    link: LinkSummary;
    sourceFile: string;
    targetPath: string;
    expectedAnchor: string | null;
    includeAnchors: boolean;
  }): { matches: boolean } {
    const { link, sourceFile, targetPath, expectedAnchor, includeAnchors } = params;
    const url = link.url;

    // Only a link to another file can be a backlink: not an external URL, not #section
    const target = parseLinkTarget(url);
    if (!(target instanceof FileTarget)) {
      return { matches: false };
    }
    const { pathPart, anchor } = target;

    // If include_anchors is false, skip links with anchors
    if (!includeAnchors && anchor) {
      return { matches: false };
    }

    // Check if resolved link matches target
    if (!this.resolvedPathMatchesTarget({ pathPart, sourceFile, targetPath })) {
      return { matches: false };
    }

    // If we're looking for a specific section, the link has to name it
    if (expectedAnchor && normalizeAnchor(anchor ?? "") !== normalizeAnchor(expectedAnchor)) {
      return { matches: false };
    }

    return { matches: true };
  }

  /**
   * Check if resolved link path matches the target file.
   * Handles various link formats:
   * - Relative paths: ../data-flow.adoc, ./data-flow.adoc
   * - Same-directory: data-flow.adoc, data-flow (without extension)
   * - Antora xref: xref:data-flow[], xref:module:page.adoc[]
   */
  private resolvedPathMatchesTarget(params: {
    pathPart: string;
    sourceFile: string;
    targetPath: string;
  }): boolean {
    const { pathPart, sourceFile, targetPath } = params;

    if (!pathPart) {
      return false;
    }

    const sourceDir = dirname(sourceFile);
    return candidatePaths(withoutModule(pathPart)).some((candidate) => resolve(sourceDir, candidate) === targetPath);
  }

  /**
   * Extract context around the link (approximately 50 chars before/after)
   */
  private extractContext(params: { lines: string[]; line: number; linkText: string }): string {
    const { lines, line, linkText } = params;
    const lineIndex = line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return "";
    }

    const lineContent = lines[lineIndex];
    const linkPos = lineContent.indexOf(linkText);

    if (linkPos === -1) {
      // Return truncated line if link text not found exactly
      return lineContent.length > 100 ? lineContent.substring(0, 100) + "..." : lineContent;
    }

    // Extract ~50 chars before and after
    const start = Math.max(0, linkPos - 50);
    const end = Math.min(lineContent.length, linkPos + linkText.length + 50);

    let context = lineContent.substring(start, end);

    // Add ellipsis if truncated
    if (start > 0) {
      context = "..." + context;
    }
    if (end < lineContent.length) {
      context = context + "...";
    }

    return context;
  }
}
