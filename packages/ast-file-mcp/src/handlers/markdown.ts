import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Root as MdastRoot, Heading, Code, List, Link, Text, ListItem } from "mdast";
import type { GoToDefinitionResult, DefinitionLocation } from "mcp-shared";
import { BaseHandler, type DocumentSummary } from "./base.js";
import { headingToDiffable } from "./heading-diff.js";
import { anchorMatchesHeading, headingAnchor } from "./anchor.js";
import { findSectionRange, groupSections } from "./sections.js";
import {
  ExternalTarget,
  FileTarget,
  parseLinkTarget,
  SameFileAnchorTarget,
  type LinkTargetVisitor,
} from "./links.js";
import { generateContent, type ContentGenerator } from "./content-format.js";
import { diffStructures, displayText } from "mcp-shared";
import type {
  AstReadResult,
  HeadingSummary,
  CodeBlockSummary,
  ListSummary,
  LinkSummary,
  QueryType,
  QueryResult,
  DiffStructureParams,
  DiffStructureResult,
  SectionResult,
  WriteSectionsParams,
} from "../types/index.js";
import type { RootContent } from "mdast";

function parseMarkdown(content: string): MdastRoot {
  return unified().use(remarkParse).parse(content) as MdastRoot;
}

/** What one `query` type reads from a parsed Markdown tree. */
interface MarkdownQuery {
  data(params: { handler: MarkdownHandler; ast: MdastRoot; depth?: number }): QueryResult["data"];
}

class FullQuery implements MarkdownQuery {
  data(params: { ast: MdastRoot }): QueryResult["data"] {
    return params.ast;
  }
}

class HeadingsQuery implements MarkdownQuery {
  data(params: { handler: MarkdownHandler; ast: MdastRoot; depth?: number }): QueryResult["data"] {
    const { handler, ast, depth } = params;
    return handler.getHeadings({ ast, maxDepth: depth });
  }
}

class CodeBlocksQuery implements MarkdownQuery {
  data(params: { handler: MarkdownHandler; ast: MdastRoot }): QueryResult["data"] {
    const { handler, ast } = params;
    return handler.getCodeBlocks(ast);
  }
}

class ListsQuery implements MarkdownQuery {
  data(params: { handler: MarkdownHandler; ast: MdastRoot }): QueryResult["data"] {
    const { handler, ast } = params;
    return handler.getLists(ast);
  }
}

class LinksQuery implements MarkdownQuery {
  data(params: { handler: MarkdownHandler; ast: MdastRoot }): QueryResult["data"] {
    const { handler, ast } = params;
    return handler.getLinks(ast);
  }
}

const MARKDOWN_QUERIES: Record<QueryType, MarkdownQuery> = {
  full: new FullQuery(),
  headings: new HeadingsQuery(),
  code_blocks: new CodeBlocksQuery(),
  lists: new ListsQuery(),
  links: new LinksQuery(),
};

/**
 * The schema admits only the keys above. Anything else can only come from
 * inside the process, and the whole tree is the answer that loses nothing.
 */
function markdownQueryFor(queryType: string): { query: QueryType; reader: MarkdownQuery } {
  const query = Object.hasOwn(MARKDOWN_QUERIES, queryType) ? (queryType as QueryType) : "full";
  return { query, reader: MARKDOWN_QUERIES[query] };
}

/**
 * go_to_definition: where each kind of link target lands. Each kind used to be
 * an arm of one 24-branch method, with the heading definition built twice.
 */
class DefinitionFinder implements LinkTargetVisitor<Promise<DefinitionLocation[]>> {
  private readonly handler: MarkdownHandler;
  private readonly filePath: string;
  private readonly ast: MdastRoot;

  constructor(params: { handler: MarkdownHandler; filePath: string; ast: MdastRoot }) {
    this.handler = params.handler;
    this.filePath = params.filePath;
    this.ast = params.ast;
  }

  external(target: ExternalTarget): Promise<DefinitionLocation[]> {
    const { url } = target;
    return Promise.resolve([{ filePath: url, line: 1, column: 1, name: url, kind: "external-link", text: url }]);
  }

  sameFileAnchor(target: SameFileAnchorTarget): Promise<DefinitionLocation[]> {
    const heading = this.handler.findHeadingBySlug({ ast: this.ast, slug: target.anchor });
    return Promise.resolve(heading ? [this.headingDefinition({ filePath: this.filePath, heading })] : []);
  }

  async file(target: FileTarget): Promise<DefinitionLocation[]> {
    const { pathPart, anchor } = target;
    const targetPath = target.resolveFrom(this.filePath);
    if (!existsSync(targetPath)) {
      return [{ filePath: targetPath, line: 1, column: 1, name: pathPart, kind: "file", text: "(file not found)" }];
    }
    if (!anchor) {
      return [{ filePath: targetPath, line: 1, column: 1, name: pathPart, kind: "file" }];
    }
    const targetAst = parseMarkdown(await readFile(targetPath, "utf-8"));
    const heading = this.handler.findHeadingBySlug({ ast: targetAst, slug: anchor });
    if (heading) {
      return [this.headingDefinition({ filePath: targetPath, heading })];
    }
    // Heading not found, point to file start
    return [{ filePath: targetPath, line: 1, column: 1, name: pathPart, kind: "file", text: `(heading "${anchor}" not found)` }];
  }

  private headingDefinition(params: { filePath: string; heading: Heading }): DefinitionLocation {
    const { filePath, heading } = params;
    const name = this.handler.extractText(heading);
    return {
      filePath,
      line: heading.position?.start?.line ?? 1,
      column: heading.position?.start?.column ?? 1,
      name,
      kind: "heading",
      text: `${"#".repeat(heading.depth)} ${name}`,
    };
  }
}

export class MarkdownHandler extends BaseHandler implements ContentGenerator {
  readonly extensions = ["md", "markdown"];
  readonly fileType = "markdown";
  readonly anchorNoun = "heading";
  readonly defaultSectionLevel = 2; // ##
  protected readonly headingLine = /^(#{1,6})\s+(.+)$/;

  async read(filePath: string): Promise<AstReadResult> {
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);

    return {
      filePath,
      fileType: "markdown",
      ast,
    };
  }

  async query(params: {
    filePath: string;
    queryType: QueryType;
    options?: { heading?: string; depth?: number };
  }): Promise<QueryResult> {
    const { filePath, queryType, options } = params;
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);

    if (options?.heading) {
      const sectionAst = this.getSection({ ast, headingText: options.heading });
      return {
        filePath,
        fileType: "markdown",
        query: "full",
        data: sectionAst,
      };
    }

    const { query, reader } = markdownQueryFor(queryType);
    return {
      filePath,
      fileType: "markdown",
      query,
      data: reader.data({ handler: this, ast, depth: options?.depth }),
    };
  }

  protected summarize(content: string): DocumentSummary {
    const ast = parseMarkdown(content);
    return { headings: this.getHeadings({ ast }), links: this.getLinks(ast) };
  }

  getHeadings(params: { ast: MdastRoot; maxDepth?: number }): HeadingSummary[] {
    const { ast, maxDepth } = params;
    const headings: HeadingSummary[] = [];

    const traverse = (node: unknown): void => {
      const n = node as { type?: string; children?: unknown[]; depth?: number; position?: { start?: { line?: number } } };
      if (n.type === "heading") {
        const heading = node as Heading;
        if (!maxDepth || heading.depth <= maxDepth) {
          headings.push({
            depth: heading.depth,
            text: this.extractText(heading),
            line: heading.position?.start?.line ?? 0,
          });
        }
      }
      if (n.children) {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };

    traverse(ast);
    return headings;
  }

  getCodeBlocks(ast: MdastRoot): CodeBlockSummary[] {
    const codeBlocks: CodeBlockSummary[] = [];

    const traverse = (node: unknown): void => {
      const n = node as { type?: string; children?: unknown[] };
      if (n.type === "code") {
        const code = node as Code;
        codeBlocks.push({
          lang: code.lang ?? null,
          value: code.value,
          line: code.position?.start?.line ?? 0,
        });
      }
      if (n.children) {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };

    traverse(ast);
    return codeBlocks;
  }

  getLists(ast: MdastRoot): ListSummary[] {
    const lists: ListSummary[] = [];

    const traverse = (node: unknown): void => {
      const n = node as { type?: string; children?: unknown[] };
      if (n.type === "list") {
        const list = node as List;
        lists.push({
          ordered: list.ordered ?? false,
          items: list.children.map((item: ListItem) => this.extractText(item)),
          line: list.position?.start?.line ?? 0,
        });
      }
      if (n.children) {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };

    traverse(ast);
    return lists;
  }

  getLinks(ast: MdastRoot): LinkSummary[] {
    const links: LinkSummary[] = [];

    const traverse = (node: unknown): void => {
      const n = node as { type?: string; children?: unknown[] };
      if (n.type === "link") {
        const link = node as Link;
        links.push({
          url: link.url,
          title: link.title ?? null,
          text: this.extractText(link),
          line: link.position?.start?.line ?? 0,
        });
      }
      if (n.children) {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };

    traverse(ast);
    return links;
  }

  getSection(params: { ast: MdastRoot; headingText: string }): MdastRoot {
    const { ast, headingText } = params;
    const range = findSectionRange({
      items: ast.children,
      headingOf: (node) => (node.type === "heading" ? { depth: node.depth, text: this.extractText(node) } : undefined),
      headingText,
    });
    return { type: "root", children: range ? ast.children.slice(range.start, range.end) : [] };
  }

  /**
   * Get headings from a file path.
   */
  async getHeadingsFromFile(params: { filePath: string; maxDepth?: number }): Promise<HeadingSummary[]> {
    const { filePath, maxDepth } = params;
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);
    return this.getHeadings({ ast, maxDepth });
  }

  /**
   * Get links from a file path.
   */
  async getLinksFromFile(filePath: string): Promise<LinkSummary[]> {
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);
    return this.getLinks(ast);
  }

  extractText(node: unknown): string {
    const n = node as { type?: string; value?: string; children?: unknown[] };
    if (n.type === "text") {
      return (node as Text).value;
    }
    if (n.children) {
      return n.children.map((child) => this.extractText(child)).join("");
    }
    return "";
  }

  async write(params: { filePath: string; ast: unknown }): Promise<void> {
    const { filePath, ast } = params;
    const processor = unified().use(remarkStringify);
    const content = processor.stringify(ast as MdastRoot);
    await writeFile(filePath, content, "utf-8");
  }

  async goToDefinition(params: {
    filePath: string;
    line: number;
    column: number;
  }): Promise<GoToDefinitionResult> {
    const { filePath, line, column } = params;
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);

    // Find the node at the given position
    const link = this.findLinkAtPosition({ ast, line, column });

    if (!link) {
      return {
        sourceFilePath: filePath,
        sourceLine: line,
        sourceColumn: column,
        identifier: "",
        definitions: [],
      };
    }

    const finder = new DefinitionFinder({ handler: this, filePath, ast });
    const definitions = await parseLinkTarget(link.url).accept(finder);
    const identifier = this.extractText(link);

    return {
      sourceFilePath: filePath,
      sourceLine: line,
      sourceColumn: column,
      identifier,
      definitions,
    };
  }

  private findLinkAtPosition(params: {
    ast: MdastRoot;
    line: number;
    column: number;
  }): Link | null {
    const { ast, line, column } = params;
    let foundLink: Link | null = null;

    const traverse = (node: unknown): void => {
      const n = node as {
        type?: string;
        children?: unknown[];
        position?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } };
      };

      if (n.position) {
        const startLine = n.position.start?.line ?? 0;
        const endLine = n.position.end?.line ?? 0;
        const startCol = n.position.start?.column ?? 0;
        const endCol = n.position.end?.column ?? 0;

        // Check if position is within this node
        const withinLines = line >= startLine && line <= endLine;
        const withinCols =
          (line === startLine && line === endLine && column >= startCol && column <= endCol) ||
          (line === startLine && line < endLine && column >= startCol) ||
          (line > startLine && line < endLine) ||
          (line > startLine && line === endLine && column <= endCol);

        if (n.type === "link" && withinLines && withinCols) {
          foundLink = node as Link;
          return;
        }
      }

      if (n.children) {
        for (const child of n.children) {
          traverse(child);
          if (foundLink) return;
        }
      }
    };

    traverse(ast);
    return foundLink;
  }

  findHeadingBySlug(params: { ast: MdastRoot; slug: string }): Heading | null {
    const { ast, slug } = params;
    for (const node of ast.children) {
      if (node.type === "heading") {
        const heading = node as Heading;
        if (anchorMatchesHeading({ anchor: slug, headingText: this.extractText(heading), fileType: "markdown" })) {
          return heading;
        }
      }
    }

    return null;
  }

  /**
   * Generate a table of contents from headings.
   * Returns Markdown-formatted TOC string.
   */
  async generateToc(params: { filePath: string; maxDepth?: number }): Promise<string> {
    const { filePath, maxDepth } = params;
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);

    const headings = this.getHeadings({ ast, maxDepth });

    if (headings.length === 0) {
      return "";
    }

    // Find minimum depth to normalize indentation
    const minDepth = Math.min(...headings.map((h) => h.depth));

    const lines = headings.map((heading) => {
      const indent = "  ".repeat(heading.depth - minDepth);
      const slug = headingAnchor({ text: heading.text, fileType: "markdown" });
      return `${indent}- [${heading.text}](#${slug})`;
    });

    return lines.join("\n");
  }

  /**
   * Compare structure of two Markdown files.
   * Returns added, removed, and modified headings.
   */
  async diffStructure(params: DiffStructureParams): Promise<DiffStructureResult> {
    const { filePathA, filePathB, level = "summary" } = params;

    // Get headings for both files
    const contentA = await readFile(filePathA, "utf-8");
    const contentB = await readFile(filePathB, "utf-8");
    const astA = parseMarkdown(contentA);
    const astB = parseMarkdown(contentB);

    const headingsA = this.getHeadings({ ast: astA });
    const headingsB = this.getHeadings({ ast: astB });

    const detailed = level === "detailed";
    const itemsA = headingsA.map((heading) => headingToDiffable({ heading, detailed }));
    const itemsB = headingsB.map((heading) => headingToDiffable({ heading, detailed }));

    // Perform diff
    const diffResult = diffStructures({ itemsA, itemsB, options: { level } });

    return {
      filePathA,
      filePathB,
      fileType: "markdown",
      added: diffResult.added,
      removed: diffResult.removed,
      modified: diffResult.modified,
      summary: diffResult.summary,
    };
  }

  // ============================================================
  // Section Manipulation Methods
  // ============================================================

  /**
   * Extract sections as independent manipulable units.
   * Returns preamble (content before first section) and sections array.
   */
  async getSections(params: { filePath: string; level?: number }): Promise<SectionResult<RootContent>> {
    const { filePath, level = 1 } = params;
    const content = await readFile(filePath, "utf-8");
    const ast = parseMarkdown(content);

    return groupSections({
      items: ast.children,
      sectionTitle: (node) => (node.type === "heading" && node.depth === level ? this.extractText(node) : undefined),
      level,
    });
  }

  /**
   * Write document from sections array.
   * Allows flexible composition of sections in any order.
   */
  async writeSections(params: WriteSectionsParams<RootContent>): Promise<void> {
    const { filePath, preamble = [], sections } = params;

    // Reconstruct AST from sections
    const children: RootContent[] = [];

    // Add preamble if present
    children.push(...preamble);

    // Add sections
    for (const section of sections) {
      children.push(...section.content);
    }

    const ast: MdastRoot = {
      type: "root",
      children,
    };

    await this.write({ filePath, ast });
  }

  // ============================================================
  // Structured Write Methods
  // ============================================================

  /**
   * Generate a Markdown table from an array of objects.
   */
  generateTable(data: Record<string, unknown>[]): string {
    if (data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
    const dataRows = data.map((row) => {
      const cells = headers.map((h) => displayText(row[h]));
      return `| ${cells.join(" | ")} |`;
    });

    return [headerRow, separatorRow, ...dataRows].join("\n");
  }

  /**
   * Generate a Markdown section with heading and content.
   */
  generateSection(options: { heading: string; depth?: number; content?: string }): string {
    const { heading, depth = 2, content } = options;
    const prefix = "#".repeat(Math.min(Math.max(depth, 1), 6));
    const lines = [`${prefix} ${heading}`];
    if (content) {
      lines.push("", content);
    }
    return lines.join("\n");
  }

  /**
   * Generate a Markdown list from an array.
   */
  generateList(params: { items: string[]; options?: { ordered?: boolean } }): string {
    const { items, options } = params;
    const ordered = options?.ordered ?? false;
    return items
       
      .map((item, i) => (ordered ? `${i + 1}. ${item}` : `- ${item}`))
      .join("\n");
  }

  /**
   * Generate a Markdown code block.
   */
  generateCode(params: { content: string; lang?: string }): string {
    const { content, lang } = params;
    const fence = "```";
    return `${fence}${lang ?? ""}\n${content}\n${fence}`;
  }

  /**
   * Generate structured content based on format type.
   */
  generate(params: { format: string; data: unknown }): string {
    const { format, data } = params;
    return generateContent({ generator: this, format, data });
  }
}
