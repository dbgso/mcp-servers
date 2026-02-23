import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import Asciidoctor from "@asciidoctor/core";
import { BaseHandler } from "./base.js";
import { diffStructures, type DiffableItem, type GoToDefinitionResult } from "mcp-shared";
import type {
  AstReadResult,
  AsciidocDocument,
  AsciidocBlock,
  HeadingSummary,
  LinkSummary,
  HeadingOverview,
  LinkOverview,
  FileSummary,
  CrawlResult,
  LinkCheckResult,
  LinkCheckItem,
  DiffStructureParams,
  DiffStructureResult,
  QueryType,
  QueryResult,
} from "../types/index.js";

const asciidoctor = Asciidoctor();

// Markers for preserving elements that asciidoctor.js doesn't retain
// Note: Document attributes are extracted separately and don't need markers
const MARKERS = {
  INCLUDE: "__ADOC_INCLUDE__",
  COMMENT: "__ADOC_COMMENT__",
  COMMENT_BLOCK_START: "__ADOC_COMMENT_BLOCK_START__",
  COMMENT_BLOCK_END: "__ADOC_COMMENT_BLOCK_END__",
} as const;

/**
 * Preprocess AsciiDoc source to preserve elements that asciidoctor.js doesn't retain.
 * Converts includes and comments to special markers.
 * Note: Document attributes are extracted separately in extractDocAttributes().
 */
function preprocess(source: string): string {
  let result = source;

  // Include directives: include::path[attrs]
  result = result.replace(/^(include::.*?\[.*?\])$/gm, `${MARKERS.INCLUDE}$1${MARKERS.INCLUDE}`);

  // Single-line comments: // comment
  result = result.replace(/^(\/\/.*)$/gm, `${MARKERS.COMMENT}$1${MARKERS.COMMENT}`);

  // Block comments: //// ... ////
  result = result.replace(
    /^(\/\/\/\/)$/gm,
    (match, _, offset) => {
      // Count how many //// we've seen before this one
      const before = result.slice(0, offset);
      const count = (before.match(/^\/\/\/\/$/gm) || []).length;
      // Even count = start, odd count = end
      return count % 2 === 0 ? MARKERS.COMMENT_BLOCK_START : MARKERS.COMMENT_BLOCK_END;
    }
  );

  return result;
}

/**
 * Postprocess serialized AsciiDoc to restore original syntax from markers.
 * Note: Document attributes are serialized directly from docAttributes field.
 */
function postprocess(output: string): string {
  let result = output;

  // Restore include directives
  result = result.replace(new RegExp(`${MARKERS.INCLUDE}(.+?)${MARKERS.INCLUDE}`, "g"), "$1");

  // Restore single-line comments
  result = result.replace(new RegExp(`${MARKERS.COMMENT}(.+?)${MARKERS.COMMENT}`, "g"), "$1");

  // Restore block comment delimiters
  result = result.replace(new RegExp(MARKERS.COMMENT_BLOCK_START, "g"), "////");
  result = result.replace(new RegExp(MARKERS.COMMENT_BLOCK_END, "g"), "////");

  return result;
}

// Type definitions for Asciidoctor objects
interface AsciidocDoc {
  getTitle(): string | undefined;
  getSections(): AsciidocSection[];
  getSource(): string;
  getBlocks(): unknown[];
}

interface AsciidocSection {
  getLevel(): number;
  getTitle(): string | undefined;
  getLineNumber(): number | undefined;
  getSections(): AsciidocSection[];
}

export class AsciidocHandler extends BaseHandler {
  readonly extensions = ["adoc", "asciidoc", "asc"];
  readonly fileType = "asciidoc";

  async read(filePath: string): Promise<AstReadResult> {
    const content = await readFile(filePath, "utf-8");

    // Extract document attributes from raw source before parsing
    // These are lines like :toc:, :author: value, etc. at the start of the document
    const docAttributes = this.extractDocAttributes(content);

    // Preprocess to preserve includes and comments
    const preprocessed = preprocess(content);
    const doc = asciidoctor.load(preprocessed);

    const ast: AsciidocDocument = {
      type: "asciidoc",
      title: doc.getTitle() as string | undefined,
      docAttributes: docAttributes.length > 0 ? docAttributes : undefined,
      blocks: this.convertBlocks({ blocks: doc.getBlocks() }),
    };

    return {
      filePath,
      fileType: "asciidoc",
      ast,
    };
  }

  /**
   * Query specific elements from a file.
   * Polymorphic method - supports headings, links, full.
   * code_blocks and lists are not supported for AsciiDoc (Markdown-specific).
   */
  async query(params: {
    filePath: string;
    queryType: QueryType;
    options?: { heading?: string; depth?: number };
  }): Promise<QueryResult> {
    const { filePath, queryType, options } = params;

    // code_blocks and lists are Markdown-specific
    if (queryType === "code_blocks" || queryType === "lists") {
      throw new Error(`Query type "${queryType}" is not supported for AsciiDoc files`);
    }

    // Section query
    if (options?.heading) {
      const content = await readFile(filePath, "utf-8");
      const doc = asciidoctor.load(content);
      const ast: AsciidocDocument = {
        type: "asciidoc",
        title: doc.getTitle() as string | undefined,
        blocks: this.convertBlocks({ blocks: doc.getBlocks() }),
      };
      // Return section as full query
      return {
        filePath,
        fileType: "asciidoc",
        query: "full",
        data: ast,
      };
    }

    switch (queryType) {
      case "headings": {
        const headings = await this.getHeadingsFromFile({ filePath, maxDepth: options?.depth });
        return {
          filePath,
          fileType: "asciidoc",
          query: "headings",
          data: headings,
        };
      }
      case "links": {
        const links = await this.getLinksFromFile(filePath);
        return {
          filePath,
          fileType: "asciidoc",
          query: "links",
          data: links,
        };
      }
      default: {
        const { ast } = await this.read(filePath);
        return {
          filePath,
          fileType: "asciidoc",
          query: "full",
          data: ast,
        };
      }
    }
  }

  /**
   * Extract document attributes from raw source.
   * Attributes are lines starting with :name: at the beginning of the document.
   */
  private extractDocAttributes(source: string): string[] {
    const lines = source.split("\n");
    const attributes: string[] = [];
    let inHeader = true;
    let foundTitle = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Document title
      if (!foundTitle && trimmed.startsWith("= ")) {
        foundTitle = true;
        continue;
      }

      // Skip empty lines in header
      if (inHeader && trimmed === "") {
        continue;
      }

      // Document attribute line
      if (inHeader && /^:[a-zA-Z_][\w-]*:/.test(trimmed)) {
        attributes.push(trimmed);
        continue;
      }

      // Any other content ends the header section
      if (trimmed !== "") {
        inHeader = false;
        break;
      }
    }

    return attributes;
  }

  private convertBlocks(params: {
    blocks: unknown[];
    visited?: WeakSet<object>;
  }): AsciidocBlock[] {
    const { blocks, visited = new WeakSet<object>() } = params;
    return blocks.map((block: unknown) => {
      // Prevent circular reference
      if (typeof block === "object" && block !== null) {
        if (visited.has(block)) {
          return { context: "circular_ref" };
        }
        visited.add(block);
      }

      const b = block as {
        getContext(): string;
        getContent?(): string;
        getLines?(): string[];
        getBlocks?(): unknown[];
        getLevel?(): number;
        getTitle?(): string;
        getStyle?(): string;
        getAttributes?(): Record<string, unknown>;
        getMarker?(): string;
      };

      const result: AsciidocBlock = {
        context: b.getContext(),
      };

      // Capture level for sections and lists
      if (typeof b.getLevel === "function") {
        const level = b.getLevel();
        if (typeof level === "number") {
          result.level = level;
        }
      }

      // Capture title for sections
      if (typeof b.getTitle === "function") {
        const title = b.getTitle();
        if (title) {
          result.title = title;
        }
      }

      // Capture style for listings (e.g., "source")
      if (typeof b.getStyle === "function") {
        const style = b.getStyle();
        if (style) {
          result.style = style;
        }
      }

      // Capture relevant attributes
      if (typeof b.getAttributes === "function") {
        const attrs = b.getAttributes();
        if (attrs && typeof attrs === "object") {
          const relevantAttrs: Record<string, string> = {};
          const keysToCapture = ["language", "source-language", "linenums", "role"];
          for (const key of keysToCapture) {
            if (key in attrs && typeof attrs[key] === "string") {
              relevantAttrs[key] = attrs[key] as string;
            }
          }
          if (Object.keys(relevantAttrs).length > 0) {
            result.attributes = relevantAttrs;
          }
        }
      }

      // Capture marker for list items
      if (typeof b.getMarker === "function") {
        const marker = b.getMarker();
        if (marker) {
          result.marker = marker;
        }
      }

      // Capture source for paragraphs (getSource returns raw AsciiDoc)
      const bWithSource = b as { getSource?(): string };
      if (typeof bWithSource.getSource === "function") {
        const source = bWithSource.getSource();
        if (source) {
          result.source = source;
        }
      }

      // Capture text for list items (getText returns rendered text)
      const bWithText = b as { getText?(): string };
      if (typeof bWithText.getText === "function") {
        const text = bWithText.getText();
        if (text) {
          result.text = text;
        }
      }

      // Capture lines
      if (typeof b.getLines === "function") {
        const lines = b.getLines();
        if (Array.isArray(lines)) {
          result.lines = lines;
        }
      }

      // Process nested blocks
      if (typeof b.getBlocks === "function") {
        const nestedBlocks = b.getBlocks();
        if (nestedBlocks && nestedBlocks.length > 0) {
          result.blocks = this.convertBlocks({ blocks: nestedBlocks, visited });
        }
      }

      return result;
    });
  }

  /**
   * Serialize AsciidocDocument back to AsciiDoc text.
   */
  private serialize(doc: AsciidocDocument): string {
    const lines: string[] = [];

    // Document title
    if (doc.title) {
      lines.push(`= ${doc.title}`);
    }

    // Document attributes (must come after title, before content)
    if (doc.docAttributes && doc.docAttributes.length > 0) {
      for (const attr of doc.docAttributes) {
        lines.push(attr);
      }
    }

    // Empty line after header
    if (doc.title || (doc.docAttributes && doc.docAttributes.length > 0)) {
      lines.push("");
    }

    // Serialize blocks
    this.serializeBlocks({ blocks: doc.blocks, lines, depth: 0 });

    return lines.join("\n");
  }

  private serializeBlocks(params: {
    blocks: AsciidocBlock[];
    lines: string[];
    depth: number;
  }): void {
    const { blocks, lines, depth } = params;

    for (const block of blocks) {
      this.serializeBlock({ block, lines, depth });
    }
  }

  private serializeBlock(params: {
    block: AsciidocBlock;
    lines: string[];
    depth: number;
  }): void {
    const { block, lines, depth } = params;
    const context = block.context;

    switch (context) {
      case "preamble":
        // Preamble contains nested blocks
        if (block.blocks) {
          this.serializeBlocks({ blocks: block.blocks, lines, depth });
        }
        break;

      case "section":
        // Section heading: == Title (level 1 = ==, level 2 = ===, etc.)
        if (block.title) {
          const level = block.level ?? 1;
          const prefix = "=".repeat(level + 1);
          lines.push(`${prefix} ${block.title}`);
          lines.push("");
        }
        // Serialize nested blocks
        if (block.blocks) {
          this.serializeBlocks({ blocks: block.blocks, lines, depth: depth + 1 });
        }
        break;

      case "paragraph":
        // Paragraph: prefer source (preserves markers), fallback to lines or text
        if (block.source) {
          lines.push(block.source);
          lines.push("");
        } else if (block.lines && block.lines.length > 0) {
          lines.push(block.lines.join("\n"));
          lines.push("");
        } else if (block.text) {
          lines.push(block.text);
          lines.push("");
        }
        break;

      case "listing":
        // Code block: [source,lang]\n----\ncode\n----
        if (block.style === "source" && block.attributes?.language) {
          lines.push(`[source,${block.attributes.language}]`);
        }
        lines.push("----");
        if (block.lines) {
          lines.push(block.lines.join("\n"));
        }
        lines.push("----");
        lines.push("");
        break;

      case "literal":
        // Literal block: ....\ntext\n....
        lines.push("....");
        if (block.lines) {
          lines.push(block.lines.join("\n"));
        }
        lines.push("....");
        lines.push("");
        break;

      case "ulist":
        // Unordered list
        if (block.blocks) {
          for (const item of block.blocks) {
            if (item.context === "list_item") {
              const marker = item.marker ?? "*";
              const text = item.text ?? item.lines?.join(" ") ?? "";
              lines.push(`${marker} ${text}`);
            }
          }
          lines.push("");
        }
        break;

      case "olist":
        // Ordered list
        if (block.blocks) {
          for (const item of block.blocks) {
            if (item.context === "list_item") {
              const marker = item.marker ?? ".";
              const text = item.text ?? item.lines?.join(" ") ?? "";
              lines.push(`${marker} ${text}`);
            }
          }
          lines.push("");
        }
        break;

      case "quote":
        // Quote block: [quote]\n____\ntext\n____
        if (block.style) {
          lines.push(`[${block.style}]`);
        }
        lines.push("____");
        if (block.lines) {
          lines.push(block.lines.join("\n"));
        }
        if (block.blocks) {
          this.serializeBlocks({ blocks: block.blocks, lines, depth: depth + 1 });
        }
        lines.push("____");
        lines.push("");
        break;

      case "sidebar":
        // Sidebar: ****\ntext\n****
        lines.push("****");
        if (block.lines) {
          lines.push(block.lines.join("\n"));
        }
        if (block.blocks) {
          this.serializeBlocks({ blocks: block.blocks, lines, depth: depth + 1 });
        }
        lines.push("****");
        lines.push("");
        break;

      case "example":
        // Example block: ====\ntext\n====
        lines.push("====");
        if (block.lines) {
          lines.push(block.lines.join("\n"));
        }
        if (block.blocks) {
          this.serializeBlocks({ blocks: block.blocks, lines, depth: depth + 1 });
        }
        lines.push("====");
        lines.push("");
        break;

      case "admonition":
        // Admonition: NOTE: text or [NOTE]\n====\ntext\n====
        const admonitionType = block.style?.toUpperCase() ?? "NOTE";
        if (block.lines && block.lines.length === 1) {
          lines.push(`${admonitionType}: ${block.lines[0]}`);
        } else {
          lines.push(`[${admonitionType}]`);
          lines.push("====");
          if (block.lines) {
            lines.push(block.lines.join("\n"));
          }
          lines.push("====");
        }
        lines.push("");
        break;

      default:
        // Fallback: output lines if present
        if (block.lines && block.lines.length > 0) {
          lines.push(block.lines.join("\n"));
          lines.push("");
        }
        // Handle nested blocks
        if (block.blocks) {
          this.serializeBlocks({ blocks: block.blocks, lines, depth: depth + 1 });
        }
    }
  }

  /**
   * Write an AsciidocDocument to a file.
   */
  async write(params: { filePath: string; ast: unknown }): Promise<void> {
    const { filePath, ast } = params;
    const serialized = this.serialize(ast as AsciidocDocument);
    // Postprocess to restore attributes, includes, and comments from markers
    const content = postprocess(serialized);
    await writeFile(filePath, content, "utf-8");
  }

  /**
   * Get all headings (sections) from an AsciiDoc document.
   */
  getHeadings(params: { doc: AsciidocDoc; maxDepth?: number }): HeadingSummary[] {
    const { doc, maxDepth } = params;
    const headings: HeadingSummary[] = [];

    // Add document title as depth 1 if present
    const title = doc.getTitle();
    // Skip title if maxDepth is specified and excludes depth 1
    if (title && (!maxDepth || maxDepth >= 1)) {
      headings.push({
        depth: 1,
        text: title as string,
        line: 1,
      });
    }

    // Recursively get all sections
    const getSections = (sections: AsciidocSection[]): void => {
      for (const section of sections) {
        const level = section.getLevel();
        // AsciiDoc level 1 (==) -> depth 2, level 2 (===) -> depth 3, etc.
        const depth = level + 1;
        // Skip if depth exceeds maxDepth
        if (maxDepth && depth > maxDepth) continue;

        headings.push({
          depth,
          text: section.getTitle() ?? "",
          line: section.getLineNumber() ?? 0,
        });

        // Get nested sections
        const nestedSections = section.getSections() as AsciidocSection[];
        if (nestedSections && nestedSections.length > 0) {
          getSections(nestedSections);
        }
      }
    };

    const sections = doc.getSections() as AsciidocSection[];
    getSections(sections);

    return headings;
  }

  /**
   * Get all links from an AsciiDoc document.
   * Includes xref (cross-references) and link macros.
   */
  getLinks(doc: AsciidocDoc): LinkSummary[] {
    const links: LinkSummary[] = [];
    const content = doc.getSource() as string;

    if (!content) return links;

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Match xref:path[text] - cross-references
      const xrefPattern = /xref:([^\[]+)\[([^\]]*)\]/g;
      let match: RegExpExecArray | null;
      while ((match = xrefPattern.exec(line)) !== null) {
        links.push({
          url: match[1],
          title: null,
          text: match[2] || match[1],
          line: lineNum,
        });
      }

      // Match link:url[text] - external links
      const linkPattern = /link:([^\[]+)\[([^\]]*)\]/g;
      while ((match = linkPattern.exec(line)) !== null) {
        links.push({
          url: match[1],
          title: null,
          text: match[2] || match[1],
          line: lineNum,
        });
      }

      // Match <<reference>> or <<reference,text>> - inline cross-references
      const inlineXrefPattern = /<<([^,>\]]+)(?:,([^>]+))?>>+/g;
      while ((match = inlineXrefPattern.exec(line)) !== null) {
        links.push({
          url: match[1],
          title: null,
          text: match[2] || match[1],
          line: lineNum,
        });
      }

      // Match include::path[] - includes
      const includePattern = /include::([^\[]+)\[([^\]]*)\]/g;
      while ((match = includePattern.exec(line)) !== null) {
        links.push({
          url: match[1],
          title: null,
          text: `include: ${match[1]}`,
          line: lineNum,
        });
      }
    }

    return links;
  }

  /**
   * Get headings from a file path.
   */
  async getHeadingsFromFile(params: { filePath: string; maxDepth?: number }): Promise<HeadingSummary[]> {
    const { filePath, maxDepth } = params;
    const content = await readFile(filePath, "utf-8");
    const doc = asciidoctor.load(content);
    return this.getHeadings({ doc, maxDepth });
  }

  /**
   * Get section content as plain text (for AI-friendly output).
   */
  async getSectionText(params: { filePath: string; headingText: string }): Promise<string> {
    const { filePath, headingText } = params;
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");

    let startLine = -1;
    let endLine = lines.length;
    let targetDepth = 0;

    // Find section boundaries by line
    // AsciiDoc: = Title (level 0), == Section (level 1), === Subsection (level 2), etc.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(={1,6})\s+(.+)$/);

      if (headingMatch) {
        const depth = headingMatch[1].length;
        const text = headingMatch[2].trim();

        if (startLine === -1 && text === headingText) {
          startLine = i;
          targetDepth = depth;
        } else if (startLine !== -1 && depth <= targetDepth) {
          endLine = i;
          break;
        }
      }
    }

    if (startLine === -1) {
      return "";
    }

    return lines.slice(startLine, endLine).join("\n").trim();
  }

  /**
   * Get links from a file path.
   */
  async getLinksFromFile(filePath: string): Promise<LinkSummary[]> {
    const content = await readFile(filePath, "utf-8");
    const doc = asciidoctor.load(content);
    return this.getLinks(doc);
  }

  /**
   * Generate a table of contents from headings.
   * Returns AsciiDoc-formatted TOC string.
   */
  async generateToc(params: { filePath: string; maxDepth?: number }): Promise<string> {
    const { filePath, maxDepth } = params;
    const headings = await this.getHeadingsFromFile({ filePath, maxDepth });

    if (headings.length === 0) {
      return "";
    }

    // Find minimum depth to normalize indentation
    const minDepth = Math.min(...headings.map((h) => h.depth));

    const lines = headings.map((heading) => {
      const stars = "*".repeat(heading.depth - minDepth + 1);
      const id = this.toSlug(heading.text);
      return `${stars} <<${id},${heading.text}>>`;
    });

    return lines.join("\n");
  }

  /**
   * Convert heading text to slug (AsciiDoc-style ID).
   */
  private toSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }

  /**
   * Convert HeadingSummary to HeadingOverview (strip line numbers).
   */
  private toHeadingOverview(headings: HeadingSummary[]): HeadingOverview[] {
    return headings.map(({ depth, text }) => ({ depth, text }));
  }

  /**
   * Convert LinkSummary to LinkOverview (strip line numbers and title).
   */
  private toLinkOverview(links: LinkSummary[]): LinkOverview[] {
    return links.map(({ url, text }) => ({ url, text }));
  }

  /**
   * Crawl from a starting file, following links recursively.
   */
  async crawl(params: { startFile: string; maxDepth?: number }): Promise<CrawlResult> {
    const { startFile: startFilePath, maxDepth = 10 } = params;
    const visited = new Set<string>();
    const files: FileSummary[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];

    const crawlFile = async (params: {
      filePath: string;
      depth: number;
    }): Promise<void> => {
      const { filePath, depth } = params;
      if (depth > maxDepth) return;

      const normalizedPath = resolve(filePath);
      if (visited.has(normalizedPath)) return;
      visited.add(normalizedPath);

      if (!existsSync(normalizedPath)) {
        errors.push({ filePath: normalizedPath, error: "File not found" });
        return;
      }

      try {
        const content = await readFile(normalizedPath, "utf-8");
        const doc = asciidoctor.load(content);

        const headings = this.getHeadings({ doc });
        const links = this.getLinks(doc);

        files.push({
          filePath: normalizedPath,
          fileType: "asciidoc",
          headings: this.toHeadingOverview(headings),
          links: this.toLinkOverview(links),
        });

        // Follow internal links
        for (const link of links) {
          if (link.url.startsWith("http://") || link.url.startsWith("https://")) {
            continue; // Skip external links
          }
          if (link.url.startsWith("#")) {
            continue; // Skip same-file anchors
          }

          const [pathPart] = link.url.split("#");
          if (!pathPart) continue;

          const targetPath = resolve(dirname(normalizedPath), pathPart);
          const ext = extname(targetPath).toLowerCase();

          if (this.extensions.includes(ext.slice(1))) {
            await crawlFile({ filePath: targetPath, depth: depth + 1 });
          }
        }
      } catch (error) {
        errors.push({
          filePath: normalizedPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await crawlFile({ filePath: startFilePath, depth: 0 });

    return {
      startFile: resolve(startFilePath),
      files,
      errors,
    };
  }

  /**
   * Find all matching files in a directory.
   */
  async findFiles(params: { directory: string; pattern?: string }): Promise<string[]> {
    const { directory, pattern } = params;
    const results: string[] = [];
    const extensions = pattern
      ? [pattern.replace("*.", "")]
      : this.extensions;

    const searchDir = async (dir: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip common non-doc directories
            if (entry.name === "node_modules" || entry.name === ".git") {
              continue;
            }
            await searchDir(fullPath);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase().slice(1);
            if (extensions.includes(ext)) {
              results.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore permission errors etc.
      }
    };

    await searchDir(directory);
    return results.sort();
  }

  /**
   * Read all files in a directory and return summaries.
   */
  async readDirectory(params: {
    directory: string;
    pattern?: string;
  }): Promise<{ files: FileSummary[]; errors: Array<{ filePath: string; error: string }> }> {
    const { directory, pattern } = params;
    const filePaths = await this.findFiles({ directory, pattern });
    const files: FileSummary[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];

    for (const filePath of filePaths) {
      try {
        const content = await readFile(filePath, "utf-8");
        const doc = asciidoctor.load(content);

        files.push({
          filePath,
          fileType: "asciidoc",
          headings: this.toHeadingOverview(this.getHeadings({ doc })),
          links: this.toLinkOverview(this.getLinks(doc)),
        });
      } catch (error) {
        errors.push({
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { files, errors };
  }

  /**
   * Check links in an AsciiDoc file.
   */
  async checkLinks(params: {
    filePath: string;
    checkExternal?: boolean;
    timeout?: number;
  }): Promise<LinkCheckResult> {
    const { filePath, checkExternal = false, timeout = 5000 } = params;
    const content = await readFile(filePath, "utf-8");
    const doc = asciidoctor.load(content);
    const links = this.getLinks(doc);
    const headings = this.getHeadings({ doc });

    const valid: LinkCheckItem[] = [];
    const broken: LinkCheckItem[] = [];
    const skipped: LinkCheckItem[] = [];

    for (const link of links) {
      const item: LinkCheckItem = {
        url: link.url,
        text: link.text,
        line: link.line,
      };

      const checkResult = await this.checkSingleLink({
        link,
        filePath,
        headings,
        checkExternal,
        timeout,
      });

      if (checkResult.status === "valid") {
        valid.push(item);
      } else if (checkResult.status === "broken") {
        broken.push({ ...item, reason: checkResult.reason });
      } else {
        skipped.push({ ...item, reason: checkResult.reason });
      }
    }

    return {
      filePath,
      valid,
      broken,
      skipped,
    };
  }

  /**
   * Check a single link and return its status.
   */
  private async checkSingleLink(params: {
    link: LinkSummary;
    filePath: string;
    headings: HeadingSummary[];
    checkExternal: boolean;
    timeout: number;
  }): Promise<{ status: "valid" | "broken" | "skipped"; reason?: string }> {
    const { link, filePath, headings, checkExternal, timeout } = params;
    const url = link.url;

    // External URL (link: macro)
    if (url.startsWith("http://") || url.startsWith("https://")) {
      if (!checkExternal) {
        return { status: "skipped", reason: "external link (check_external=false)" };
      }
      return this.checkExternalUrl({ url, timeout });
    }

    // Anchor reference (inline xref without file: <<anchor>>)
    // These don't start with #, they're just IDs
    if (!url.includes("/") && !url.includes(".")) {
      // Looks like an anchor reference
      const anchorId = url;
      const headingSlug = headings.find((h) => this.toSlug(h.text) === anchorId);
      if (headingSlug) {
        return { status: "valid" };
      }
      // Also check if it matches heading text directly
      const headingMatch = headings.find((h) => h.text === anchorId);
      if (headingMatch) {
        return { status: "valid" };
      }
      return { status: "broken", reason: `anchor "${anchorId}" not found` };
    }

    // File reference (xref:file.adoc[] or include::file.adoc[])
    const [pathPart, anchor] = url.split("#");
    const targetPath = pathPart ? resolve(dirname(filePath), pathPart) : filePath;

    if (!existsSync(targetPath)) {
      return { status: "broken", reason: "file not found" };
    }

    // File exists, check anchor if present
    if (!anchor) {
      return { status: "valid" };
    }

    // Check anchor in target file
    try {
      const targetContent = await readFile(targetPath, "utf-8");
      const targetDoc = asciidoctor.load(targetContent);
      const targetHeadings = this.getHeadings({ doc: targetDoc });
      const targetSlug = targetHeadings.find((h) => this.toSlug(h.text) === anchor);

      if (targetSlug) {
        return { status: "valid" };
      }
      return { status: "broken", reason: `anchor "${anchor}" not found in ${pathPart}` };
    } catch {
      return { status: "broken", reason: `failed to read ${pathPart}` };
    }
  }

  /**
   * Check an external URL using HTTP HEAD request.
   */
  private async checkExternalUrl(params: {
    url: string;
    timeout: number;
  }): Promise<{ status: "valid" | "broken" | "skipped"; reason?: string }> {
    const { url, timeout } = params;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
          redirect: "follow",
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return { status: "valid" };
        }

        // Some servers don't support HEAD, try GET
        if (response.status === 405) {
          const getResponse = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            redirect: "follow",
          });
          if (getResponse.ok) {
            return { status: "valid" };
          }
          return { status: "broken", reason: `HTTP ${getResponse.status}` };
        }

        return { status: "broken", reason: `HTTP ${response.status}` };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { status: "broken", reason: "timeout" };
      }
      return { status: "broken", reason: error instanceof Error ? error.message : "unknown error" };
    }
  }

  /**
   * Compare structure of two AsciiDoc files.
   * Returns added, removed, and modified headings.
   */
  async diffStructure(params: DiffStructureParams): Promise<DiffStructureResult> {
    const { filePathA, filePathB, level = "summary" } = params;

    // Get headings for both files
    const headingsA = await this.getHeadingsFromFile({ filePath: filePathA });
    const headingsB = await this.getHeadingsFromFile({ filePath: filePathB });

    // Convert HeadingSummary to DiffableItem
    // Use depth + text as key for matching (allows same text at different depths)
    const itemsA: DiffableItem[] = headingsA.map((h) => ({
      key: `${h.depth}:${h.text}`,
      kind: `h${h.depth}`,
      line: h.line,
      properties: level === "detailed" ? {
        depth: h.depth,
        text: h.text,
      } : undefined,
    }));

    const itemsB: DiffableItem[] = headingsB.map((h) => ({
      key: `${h.depth}:${h.text}`,
      kind: `h${h.depth}`,
      line: h.line,
      properties: level === "detailed" ? {
        depth: h.depth,
        text: h.text,
      } : undefined,
    }));

    // Perform diff
    const diffResult = diffStructures({ itemsA, itemsB, options: { level } });

    return {
      filePathA,
      filePathB,
      fileType: "asciidoc",
      added: diffResult.added,
      removed: diffResult.removed,
      modified: diffResult.modified,
      summary: diffResult.summary,
    };
  }

  /**
   * Go to definition is not supported for AsciiDoc files.
   */
  async goToDefinition(_params: {
    filePath: string;
    line: number;
    column: number;
  }): Promise<GoToDefinitionResult> {
    throw new Error("goToDefinition is not supported for AsciiDoc files");
  }

  // ============================================================
  // Structured Write Methods
  // ============================================================

  /**
   * Generate an AsciiDoc table from an array of objects.
   */
  generateTable(data: Record<string, unknown>[]): string {
    if (data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const lines = [
      "[cols=\"" + headers.map(() => "1").join(",") + "\", options=\"header\"]",
      "|===",
      headers.map((h) => `| ${h}`).join(" "),
      "",
    ];

    for (const row of data) {
      lines.push(headers.map((h) => `| ${String(row[h] ?? "")}`).join(" "));
    }
    lines.push("|===");

    return lines.join("\n");
  }

  /**
   * Generate an AsciiDoc section with heading and content.
   */
  generateSection(options: { heading: string; depth?: number; content?: string }): string {
    const { heading, depth = 2, content } = options;
    const prefix = "=".repeat(Math.min(Math.max(depth, 1), 6));
    const lines = [`${prefix} ${heading}`];
    if (content) {
      lines.push("", content);
    }
    return lines.join("\n");
  }

  /**
   * Generate an AsciiDoc list from an array.
   */
  generateList(params: { items: string[]; options?: { ordered?: boolean } }): string {
    const { items, options } = params;
    const ordered = options?.ordered ?? false;
    return items
      .map((item) => (ordered ? `. ${item}` : `* ${item}`))
      .join("\n");
  }

  /**
   * Generate an AsciiDoc code block.
   */
  generateCode(params: { content: string; lang?: string }): string {
    const { content, lang } = params;
    const lines = [];
    if (lang) {
      lines.push(`[source,${lang}]`);
    }
    lines.push("----", content, "----");
    return lines.join("\n");
  }

  /**
   * Generate structured content based on format type.
   */
  generate(params: { format: string; data: unknown }): string {
    const { format, data } = params;
    switch (format) {
      case "table":
        return this.generateTable(data as Record<string, unknown>[]);
      case "section":
        return this.generateSection(data as { heading: string; depth?: number; content?: string });
      case "list": {
        const listData = data as { items: string[]; ordered?: boolean };
        return this.generateList({ items: listData.items, options: { ordered: listData.ordered } });
      }
      case "code": {
        const codeData = data as { content: string; lang?: string };
        return this.generateCode({ content: codeData.content, lang: codeData.lang });
      }
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }
}
