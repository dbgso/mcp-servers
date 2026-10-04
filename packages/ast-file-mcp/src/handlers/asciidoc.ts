import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Asciidoctor from "@asciidoctor/core";
import { BaseHandler, type DocumentSummary } from "./base.js";
import { headingToDiffable } from "./heading-diff.js";
import { headingAnchor } from "./anchor.js";
import { groupSections } from "./sections.js";
import { isExternalUrl, SameFileAnchorTarget, type LinkCheckContext, type LinkOutcome, type LinkTarget } from "./links.js";
import { convertBlocks } from "./asciidoc-convert.js";
import { serializeBlocks } from "./asciidoc-serialize.js";
import { generateContent, type ContentGenerator } from "./content-format.js";
import { diffStructures, displayText, type GoToDefinitionResult } from "mcp-shared";
import type {
  AstReadResult,
  AsciidocDocument,
  AsciidocBlock,
  HeadingSummary,
  LinkSummary,
  CodeBlockSummary,
  DiffStructureParams,
  DiffStructureResult,
  QueryType,
  QueryResult,
  SectionResult,
  WriteSectionsParams,
} from "../types/index.js";

const asciidoctor = Asciidoctor();

/** A section title line: `= Title` (depth 1) to `====== Title` (depth 6). */
const HEADING_LINE = /^(={1,6})\s+(.+)$/;

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

/** What one `query` type reads from an AsciiDoc file. */
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

/** `lists` is Markdown's alone: AsciiDoc lists are read through `full`. */
class UnsupportedQuery implements AsciidocQuery {
  constructor(private readonly queryType: QueryType) {}

  data(): Promise<QueryResult["data"]> {
    return Promise.reject(new Error(`Query type "${this.queryType}" is not supported for AsciiDoc files`));
  }
}

const ASCIIDOC_QUERIES: Record<QueryType, AsciidocQuery> = {
  full: new FullQuery(),
  headings: new HeadingsQuery(),
  code_blocks: new CodeBlocksQuery(),
  lists: new UnsupportedQuery("lists"),
  links: new LinksQuery(),
};

/** As for Markdown: a query type outside the schema reads the whole document. */
function asciidocQueryFor(queryType: string): { query: QueryType; reader: AsciidocQuery } {
  const query = Object.hasOwn(ASCIIDOC_QUERIES, queryType) ? (queryType as QueryType) : "full";
  return { query, reader: ASCIIDOC_QUERIES[query] };
}

/** The first section titled `heading`, at any depth, or undefined. */
function findSectionBlock(params: { blocks: AsciidocBlock[]; heading: string }): AsciidocBlock | undefined {
  const { blocks, heading } = params;
  for (const block of blocks) {
    if (block.context === "section" && block.title === heading) return block;
    const nested = findSectionBlock({ blocks: block.blocks ?? [], heading });
    if (nested) return nested;
  }
  return undefined;
}

export class AsciidocHandler extends BaseHandler implements ContentGenerator {
  readonly extensions = ["adoc", "asciidoc", "asc"];
  readonly fileType = "asciidoc";
  readonly anchorNoun = "anchor";
  protected readonly headingLine = HEADING_LINE;

  protected summarize(content: string): DocumentSummary {
    const doc = asciidoctor.load(content);
    return { headings: this.getHeadings({ doc }), links: this.getLinks(doc) };
  }

  /**
   * `<<anchor>>` and `<<other-file>>` carry no `#`, no `/` and no `.`: a bare
   * id, which names a place in this document or a sibling page.
   */
  protected linkTarget(url: string): LinkTarget {
    if (!isExternalUrl(url) && !url.includes("/") && !url.includes(".")) {
      return new SameFileAnchorTarget(url);
    }
    return super.linkTarget(url);
  }

  /** A bare id may also be a heading's own text, or the name of a sibling `.adoc` page. */
  checkSameFileAnchor(params: { anchor: string; context: LinkCheckContext }): LinkOutcome {
    const { anchor, context } = params;
    const namesHeadingText = context.headings.some((h) => h.text === anchor);
    if (namesHeadingText || existsSync(resolve(dirname(context.filePath), `${anchor}.adoc`))) {
      return { status: "valid" };
    }
    return super.checkSameFileAnchor(params);
  }

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

    // Section query: the section block alone, as Markdown returns its section
    if (options?.heading) {
      return {
        filePath,
        fileType: "asciidoc",
        query: "full",
        data: await this.readSection({ filePath, heading: options.heading }),
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
   * The section titled `heading` as a document of its own; no blocks when no
   * section has that title.
   */
  private async readSection(params: { filePath: string; heading: string }): Promise<AsciidocDocument> {
    const { ast } = await this.read(params.filePath);
    const section = findSectionBlock({ blocks: (ast as AsciidocDocument).blocks, heading: params.heading });
    return { type: "asciidoc", blocks: section ? [section] : [] };
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


    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(HEADING_LINE);

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

    // asciidoctor wraps what precedes the first section in a `preamble` block
    const items = doc.blocks.flatMap((block) => (block.context === "preamble" ? (block.blocks ?? []) : [block]));
    const { preamble, sections } = groupSections({
      items,
      sectionTitle: (block) => (block.context === "section" && block.level === level ? (block.title ?? "") : undefined),
      level,
    });

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
