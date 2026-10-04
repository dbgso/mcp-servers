import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import Asciidoctor from "@asciidoctor/core";
import { BaseHandler } from "./base.js";
import { headingToDiffable } from "./heading-diff.js";
import { anchorMatchesHeading, headingAnchor } from "./anchor.js";
import { convertBlocks } from "./asciidoc-convert.js";
import { serializeBlocks } from "./asciidoc-serialize.js";
import { generateContent, type ContentGenerator } from "./content-format.js";
import { diffStructures, displayText, type GoToDefinitionResult, getErrorMessage } from "mcp-shared";
import type {
  AstReadResult,
  AsciidocDocument,
  AsciidocBlock,
  HeadingSummary,
  LinkSummary,
  CodeBlockSummary,
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
  SectionResult,
  Section,
  WriteSectionsParams,
} from "../types/index.js";

const asciidoctor = Asciidoctor();

// Markers for preserving elements that asciidoctor.js doesn't retain
// Note: Document attributes are extracted separately and don't need markers
const MARKERS = {
  INCLUDE: "__ADOC_INCLUDE__",
  COMMENT: "__ADOC_COMMENT__",
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

  // Single-line comments: // comment. A block comment's `////` delimiters are
  // matched by this rule too -- they are a line starting with `//` -- so each
  // one comes back through the same marker and the block survives a round trip
  // without a rule of its own. The pair of markers that used to do that never
  // ran: this replace had already consumed the delimiters by the time it was
  // reached.
  result = result.replace(/^(\/\/.*)$/gm, `${MARKERS.COMMENT}$1${MARKERS.COMMENT}`);

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

  // Restore single-line comments, block-comment delimiters included.
  result = result.replace(new RegExp(`${MARKERS.COMMENT}(.+?)${MARKERS.COMMENT}`, "g"), "$1");

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

/**
 * What one `query` type reads from an AsciiDoc file. `lists` is Markdown's
 * alone and is refused before the lookup.
 */
interface AsciidocQuery {
  data(params: { handler: AsciidocHandler; filePath: string; depth?: number }): Promise<QueryResult["data"]>;
}

class FullQuery implements AsciidocQuery {
  async data(params: { handler: AsciidocHandler; filePath: string }): Promise<QueryResult["data"]> {
    const { handler, filePath } = params;
    const { ast } = await handler.read(filePath);
    return ast as AsciidocDocument;
  }
}

class HeadingsQuery implements AsciidocQuery {
  data(params: { handler: AsciidocHandler; filePath: string; depth?: number }): Promise<QueryResult["data"]> {
    const { handler, filePath, depth } = params;
    return handler.getHeadingsFromFile({ filePath, maxDepth: depth });
  }
}

class CodeBlocksQuery implements AsciidocQuery {
  data(params: { handler: AsciidocHandler; filePath: string }): Promise<QueryResult["data"]> {
    const { handler, filePath } = params;
    return handler.getCodeBlocksFromFile(filePath);
  }
}

class LinksQuery implements AsciidocQuery {
  data(params: { handler: AsciidocHandler; filePath: string }): Promise<QueryResult["data"]> {
    const { handler, filePath } = params;
    return handler.getLinksFromFile(filePath);
  }
}

const ASCIIDOC_QUERIES: Record<Exclude<QueryType, "lists">, AsciidocQuery> = {
  full: new FullQuery(),
  headings: new HeadingsQuery(),
  code_blocks: new CodeBlocksQuery(),
  links: new LinksQuery(),
};

/** As for Markdown: a query type outside the schema reads the whole document. */
function asciidocQueryFor(queryType: string): { query: Exclude<QueryType, "lists">; reader: AsciidocQuery } {
  const query = Object.hasOwn(ASCIIDOC_QUERIES, queryType) ? (queryType as Exclude<QueryType, "lists">) : "full";
  return { query, reader: ASCIIDOC_QUERIES[query] };
}

export class AsciidocHandler extends BaseHandler implements ContentGenerator {
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
      blocks: convertBlocks({ blocks: doc.getBlocks() }),
    };

    return {
      filePath,
      fileType: "asciidoc",
      ast,
    };
  }

  /**
   * Query specific elements from a file.
   * Polymorphic method - supports headings, links, code_blocks, full.
   * lists are not supported for AsciiDoc (Markdown-specific).
   */
  async query(params: {
    filePath: string;
    queryType: QueryType;
    options?: { heading?: string; depth?: number };
  }): Promise<QueryResult> {
    const { filePath, queryType, options } = params;

    // lists are Markdown-specific
    if (queryType === "lists") {
      throw new Error(`Query type "${queryType}" is not supported for AsciiDoc files`);
    }

    // Section query
    if (options?.heading) {
      const content = await readFile(filePath, "utf-8");
      const doc = asciidoctor.load(content);
      const ast: AsciidocDocument = {
        type: "asciidoc",
        title: doc.getTitle() as string | undefined,
        blocks: convertBlocks({ blocks: doc.getBlocks() }),
      };
      // Return section as full query
      return {
        filePath,
        fileType: "asciidoc",
        query: "full",
        data: ast,
      };
    }

    const { query, reader } = asciidocQueryFor(queryType);
    return {
      filePath,
      fileType: "asciidoc",
      query,
      data: await reader.data({ handler: this, filePath, depth: options?.depth }),
    };
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
    serializeBlocks({ blocks: doc.blocks, lines, depth: 0 });

    return lines.join("\n");
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

    // Parse headings directly from source for accurate line numbers
    // Asciidoctor.js getLineNumber() returns undefined for most sections
    return this.parseHeadingsFromSource({ content, maxDepth });
  }

  /**
   * Parse headings directly from AsciiDoc source for accurate line numbers.
   * AsciiDoc heading format: = Title (h1), == Section (h2), === Subsection (h3), etc.
   */
  private parseHeadingsFromSource(params: { content: string; maxDepth?: number }): HeadingSummary[] {
    const { content, maxDepth } = params;
    const lines = content.split("\n");
    const headings: HeadingSummary[] = [];

    // Regex to match AsciiDoc section headings: = Title, == Section, etc.
    // Must be at start of line, followed by space and title text
    const headingRegex = /^(=+)\s+(.+)$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(headingRegex);

      if (match) {
        const equalSigns = match[1];
        const text = match[2].trim();
        // = is depth 1, == is depth 2, etc.
        const depth = equalSigns.length;

        // Skip if depth exceeds maxDepth
        if (maxDepth && depth > maxDepth) continue;

        headings.push({
          depth,
          text,
          line: i + 1, // 1-based line number
        });
      }
    }

    return headings;
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
   * Get code blocks from a file.
   * Extracts [source,lang] blocks (listing blocks with style="source").
   */
  async getCodeBlocksFromFile(filePath: string): Promise<CodeBlockSummary[]> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const codeBlocks: CodeBlockSummary[] = [];

    // Parse using regex to get accurate line numbers
    // [source,lang] followed by ---- block
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Check for [source,lang] or [source] attribute
      const sourceMatch = line.match(/^\[source(?:,\s*(\w+))?\]/);
      if (sourceMatch) {
        const lang = sourceMatch[1] ?? null;

        // Look for ---- on the next line
        if (i + 1 < lines.length && lines[i + 1].trim() === "----") {
          const startLine = i + 1; // Line number of ----
          const contentLines: string[] = [];
          let j = i + 2;

          // Collect content until closing ----
          while (j < lines.length && lines[j].trim() !== "----") {
            contentLines.push(lines[j]);
            j++;
          }

          codeBlocks.push({
            lang,
            value: contentLines.join("\n"),
            line: startLine + 1, // 1-based line number
          });

          i = j + 1; // Skip past closing ----
          continue;
        }
      }

      // Also check for bare ---- blocks (listing without [source])
      if (line.trim() === "----" && (i === 0 || !lines[i - 1].match(/^\[source/))) {
        const startLine = i;
        const contentLines: string[] = [];
        let j = i + 1;

        // Collect content until closing ----
        while (j < lines.length && lines[j].trim() !== "----") {
          contentLines.push(lines[j]);
          j++;
        }

        // Only add if we found a closing delimiter
        if (j < lines.length) {
          codeBlocks.push({
            lang: null,
            value: contentLines.join("\n"),
            line: startLine + 1, // 1-based line number
          });
        }

        i = j + 1;
        continue;
      }

      i++;
    }

    return codeBlocks;
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
      const id = headingAnchor({ text: heading.text, fileType: "asciidoc" });
      return `${stars} <<${id},${heading.text}>>`;
    });

    return lines.join("\n");
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
          error: getErrorMessage(error),
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
          error: getErrorMessage(error),
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

    // Anchor or cross-file reference (inline xref without file extension: <<anchor>> or <<other-file>>)
    // These don't start with #, they're just IDs
    if (!url.includes("/") && !url.includes(".")) {
      const anchorId = url;

      // 1. An anchor in the same file, by id or by the heading text itself
      if (headings.some((h) => h.text === anchorId || this.isAnchorOf({ anchor: anchorId, heading: h }))) {
        return { status: "valid" };
      }

      // 2. Check if it's a cross-file reference (<<other-file>> -> other-file.adoc)
      const sourceDir = dirname(filePath);
      const potentialFile = resolve(sourceDir, anchorId + ".adoc");
      if (existsSync(potentialFile)) {
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
      if (targetHeadings.some((h) => this.isAnchorOf({ anchor, heading: h }))) {
        return { status: "valid" };
      }
      return { status: "broken", reason: `anchor "${anchor}" not found in ${pathPart}` };
    } catch {
      return { status: "broken", reason: `failed to read ${pathPart}` };
    }
  }

  private isAnchorOf(params: { anchor: string; heading: HeadingSummary }): boolean {
    return anchorMatchesHeading({ anchor: params.anchor, headingText: params.heading.text, fileType: "asciidoc" });
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
      return { status: "broken", reason: getErrorMessage(error) };
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

    const detailed = level === "detailed";
    const itemsA = headingsA.map((heading) => headingToDiffable({ heading, detailed }));
    const itemsB = headingsB.map((heading) => headingToDiffable({ heading, detailed }));

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
  // Section Manipulation Methods
  // ============================================================

  /**
   * Extract sections as independent manipulable units.
   * Returns preamble (content before first section) and sections array.
   */
  async getSections(params: { filePath: string; level?: number }): Promise<SectionResult<AsciidocBlock>> {
    const { filePath, level = 1 } = params;
    const { ast } = await this.read(filePath);
    const doc = ast as AsciidocDocument;

    const preamble: AsciidocBlock[] = [];
    const sections: Section<AsciidocBlock>[] = [];

    for (const block of doc.blocks) {
      if (block.context === "preamble") {
        // Preamble content goes before sections
        if (block.blocks) {
          preamble.push(...block.blocks);
        }
      } else if (block.context === "section" && block.level === level) {
        // Top-level section
        sections.push({
          title: block.title ?? "",
          level: block.level,
          content: [block],
        });
      } else {
        // Content outside of sections goes to preamble
        preamble.push(block);
      }
    }

    return {
      preamble,
      sections,
      title: doc.title,
      docAttributes: doc.docAttributes,
    };
  }

  /**
   * Write document from sections array.
   * Allows flexible composition of sections in any order.
   */
  async writeSections(params: WriteSectionsParams<AsciidocBlock>): Promise<void> {
    const { filePath, preamble = [], sections, docAttributes, title } = params;

    // Reconstruct AST from sections
    const blocks: AsciidocBlock[] = [];

    // Add preamble if present
    if (preamble.length > 0) {
      blocks.push({
        context: "preamble",
        blocks: preamble,
      });
    }

    // Add sections
    for (const section of sections) {
      // Section content includes the section block itself
      blocks.push(...section.content);
    }

    const doc: AsciidocDocument = {
      type: "asciidoc",
      title,
      docAttributes,
      blocks,
    };

    await this.write({ filePath, ast: doc });
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
      lines.push(headers.map((h) => `| ${displayText(row[h])}`).join(" "));
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
    return generateContent({ generator: this, format, data });
  }
}
