import { z } from "zod";
import { resolve, dirname, relative } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { MarkdownHandler, AsciidocHandler } from "../../handlers/index.js";
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

    const mdHandler = new MarkdownHandler();
    const adocHandler = new AsciidocHandler();

    // Get all files in directory
    const [mdFiles, adocFiles] = await Promise.all([
      mdHandler.findFiles({ directory }),
      adocHandler.findFiles({ directory }),
    ]);

    const allFiles = [...mdFiles, ...adocFiles];
    const backlinks: Backlink[] = [];
    const sourceFilesSet = new Set<string>();

    // Generate expected anchor from section heading
    const expectedAnchor = section_heading
      ? this.generateAnchor({ text: section_heading, fileType: this.getFileType(targetPath) })
      : null;

    for (const sourceFile of allFiles) {
      // Skip self-references
      if (resolve(sourceFile) === targetPath) {
        continue;
      }

      const handler = this.getHandlerForFile(sourceFile, mdHandler, adocHandler);
      if (!handler) {
        continue;
      }

      try {
        const links = await handler.getLinksFromFile(sourceFile);
        const fileContent = await readFile(sourceFile, "utf-8");
        const lines = fileContent.split("\n");

        for (const link of links) {
          const matchResult = this.checkLinkMatchesTarget({
            link,
            sourceFile,
            targetPath,
            expectedAnchor,
            includeAnchors: include_anchors,
          });

          if (matchResult.matches) {
            sourceFilesSet.add(sourceFile);

            // Extract context (~50 chars before/after the link on the same line)
            const context = this.extractContext({ lines, line: link.line, linkText: link.text });

            backlinks.push({
              sourceFile,
              sourceLine: link.line,
              linkText: link.text,
              linkUrl: link.url,
              context,
            });
          }
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    const result: FindBacklinksResult = {
      targetFile: targetPath,
      targetSection: section_heading,
      backlinks,
      summary: {
        totalBacklinks: backlinks.length,
        sourceFiles: sourceFilesSet.size,
      },
    };

    return jsonResponse(result);
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

    // Skip external URLs
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return { matches: false };
    }

    // Skip same-file anchor references (e.g., #section)
    if (url.startsWith("#")) {
      return { matches: false };
    }

    // Parse the URL into path and anchor parts
    const [pathPart, anchor] = url.split("#");

    // If include_anchors is false, skip links with anchors
    if (!includeAnchors && anchor) {
      return { matches: false };
    }

    // Check if resolved link matches target
    if (!this.resolvedPathMatchesTarget({ pathPart, sourceFile, targetPath })) {
      return { matches: false };
    }

    // If we're looking for a specific section, check the anchor
    if (expectedAnchor) {
      if (!anchor) {
        return { matches: false };
      }

      // Normalize anchors for comparison (case-insensitive)
      const normalizedAnchor = anchor.toLowerCase().replace(/^_/, "").replace(/_/g, "-");
      const normalizedExpected = expectedAnchor.toLowerCase().replace(/^_/, "").replace(/_/g, "-");

      if (normalizedAnchor !== normalizedExpected) {
        return { matches: false };
      }
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
    const targetBasename = targetPath.split("/").pop() ?? "";
    const targetBasenameNoExt = targetBasename.replace(/\.(adoc|asciidoc|asc|md|markdown)$/, "");

    // Handle Antora module prefix (e.g., "module:page" -> "page")
    let cleanPath = pathPart;
    if (pathPart.includes(":") && !pathPart.startsWith(".")) {
      // Remove module prefix for same-module links
      cleanPath = pathPart.split(":").pop() ?? pathPart;
    }

    // Try direct resolution first
    const resolvedPath = resolve(sourceDir, cleanPath);
    if (resolvedPath === targetPath) {
      return true;
    }

    // Try with .adoc extension added
    const resolvedWithAdoc = resolve(sourceDir, cleanPath + ".adoc");
    if (resolvedWithAdoc === targetPath) {
      return true;
    }

    // Try basename matching (for simple xref like "data-flow" matching "data-flow.adoc")
    const linkBasename = cleanPath.split("/").pop() ?? "";
    const linkBasenameNoExt = linkBasename.replace(/\.(adoc|asciidoc|asc|md|markdown)$/, "");

    // Check if link is just a basename (no directory separators)
    if (!cleanPath.includes("/") && !cleanPath.includes("..")) {
      // Compare basenames (case-insensitive)
      if (linkBasenameNoExt.toLowerCase() === targetBasenameNoExt.toLowerCase()) {
        // Verify they're in the same directory or the link could resolve to target
        const potentialPath = resolve(sourceDir, linkBasenameNoExt + ".adoc");
        if (potentialPath === targetPath) {
          return true;
        }
        // Also check if target is in a parent/sibling architecture folder
        const potentialPathMd = resolve(sourceDir, linkBasenameNoExt + ".md");
        if (potentialPathMd === targetPath) {
          return true;
        }
      }
    }

    return false;
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

  /**
   * Generate anchor from heading text (matches topic-index pattern)
   */
  private generateAnchor(params: { text: string; fileType: "markdown" | "asciidoc" }): string {
    const { text, fileType } = params;
    if (fileType === "markdown") {
      // GitHub-flavored markdown anchor generation
      return text
        .toLowerCase()
        .replace(/[^\w\s\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    } else {
      // AsciiDoc anchor: _text_with_underscores
      return "_" + text
        .toLowerCase()
        .replace(/[^\w\s\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    }
  }

  /**
   * Determine file type from extension
   */
  private getFileType(filePath: string): "markdown" | "asciidoc" {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (["adoc", "asciidoc", "asc"].includes(ext)) {
      return "asciidoc";
    }
    return "markdown";
  }

  /**
   * Get the appropriate handler for a file
   */
  private getHandlerForFile(
    filePath: string,
    mdHandler: MarkdownHandler,
    adocHandler: AsciidocHandler
  ): MarkdownHandler | AsciidocHandler | null {
    if (mdHandler.canHandle(filePath)) {
      return mdHandler;
    }
    if (adocHandler.canHandle(filePath)) {
      return adocHandler;
    }
    return null;
  }
}
