import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Root as MdastRoot, Heading, Code, List, Link, Text, ListItem } from "mdast";
import type { GoToDefinitionResult, DefinitionLocation } from "mcp-shared";
import { BaseHandler } from "./base.js";
import { diffStructures, type DiffableItem } from "mcp-shared";
import type {
  AstReadResult,
  HeadingSummary,
  CodeBlockSummary,
  ListSummary,
  LinkSummary,
  HeadingOverview,
  LinkOverview,
  QueryType,
  QueryResult,
  FileSummary,
  CrawlResult,
  LinkCheckResult,
  LinkCheckItem,
  DiffStructureParams,
  DiffStructureResult,
  SectionResult,
  Section,
  WriteSectionsParams,
} from "../types/index.js";
import type { RootContent } from "mdast";

export class MarkdownHandler extends BaseHandler {
  readonly extensions = ["md", "markdown"];
  readonly fileType = "markdown";

  async read(filePath: string): Promise<AstReadResult> {
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

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
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

    if (options?.heading) {
      const sectionAst = this.getSection({ ast, headingText: options.heading });
      return {
        filePath,
        fileType: "markdown",
        query: "full",
        data: sectionAst,
      };
    }

    switch (queryType) {
      case "headings":
        return {
          filePath,
          fileType: "markdown",
          query: "headings",
          data: this.getHeadings({ ast, maxDepth: options?.depth }),
        };
      case "code_blocks":
        return {
          filePath,
          fileType: "markdown",
          query: "code_blocks",
          data: this.getCodeBlocks(ast),
        };
      case "lists":
        return {
          filePath,
          fileType: "markdown",
          query: "lists",
          data: this.getLists(ast),
        };
      case "links":
        return {
          filePath,
          fileType: "markdown",
          query: "links",
          data: this.getLinks(ast),
        };
      default:
        return {
          filePath,
          fileType: "markdown",
          query: "full",
          data: ast,
        };
    }
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
    const children = ast.children;
    let startIdx = -1;
    let endIdx = children.length;
    let targetDepth = 0;

    // Find the heading
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type === "heading") {
        const text = this.extractText(node as Heading);
        if (startIdx === -1 && text === headingText) {
          startIdx = i;
          targetDepth = (node as Heading).depth;
        } else if (startIdx !== -1 && (node as Heading).depth <= targetDepth) {
          endIdx = i;
          break;
        }
      }
    }

    if (startIdx === -1) {
      return { type: "root", children: [] };
    }

    return {
      type: "root",
      children: children.slice(startIdx, endIdx),
    };
  }

  /**
   * Get headings from a file path.
   */
  async getHeadingsFromFile(params: { filePath: string; maxDepth?: number }): Promise<HeadingSummary[]> {
    const { filePath, maxDepth } = params;
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;
    return this.getHeadings({ ast, maxDepth });
  }

  /**
   * Get links from a file path.
   */
  async getLinksFromFile(filePath: string): Promise<LinkSummary[]> {
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;
    return this.getLinks(ast);
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
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

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

  private extractText(node: unknown): string {
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
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

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

    const identifier = this.extractText(link);
    const definitions: DefinitionLocation[] = [];

    // Parse the URL
    const url = link.url;

    if (url.startsWith("#")) {
      // Same file heading reference: #heading-id
      const headingId = url.slice(1);
      const targetHeading = this.findHeadingBySlug({ ast, slug: headingId });

      if (targetHeading) {
        definitions.push({
          filePath,
          line: targetHeading.position?.start?.line ?? 1,
          column: targetHeading.position?.start?.column ?? 1,
          name: this.extractText(targetHeading),
          kind: "heading",
          text: `${"#".repeat(targetHeading.depth)} ${this.extractText(targetHeading)}`,
        });
      }
    } else if (url.startsWith("http://") || url.startsWith("https://")) {
      // External URL - return as-is
      definitions.push({
        filePath: url,
        line: 1,
        column: 1,
        name: url,
        kind: "external-link",
        text: url,
      });
    } else {
      // Relative file path, possibly with anchor
      const [pathPart, anchor] = url.split("#");
      const targetPath = pathPart ? resolve(dirname(filePath), pathPart) : filePath;

      if (existsSync(targetPath)) {
        if (anchor) {
          // File with heading reference
          const targetContent = await readFile(targetPath, "utf-8");
          const targetAst = processor.parse(targetContent) as MdastRoot;
          const targetHeading = this.findHeadingBySlug({ ast: targetAst, slug: anchor });

          if (targetHeading) {
            definitions.push({
              filePath: targetPath,
              line: targetHeading.position?.start?.line ?? 1,
              column: targetHeading.position?.start?.column ?? 1,
              name: this.extractText(targetHeading),
              kind: "heading",
              text: `${"#".repeat(targetHeading.depth)} ${this.extractText(targetHeading)}`,
            });
          } else {
            // Heading not found, point to file start
            definitions.push({
              filePath: targetPath,
              line: 1,
              column: 1,
              name: pathPart,
              kind: "file",
              text: `(heading "${anchor}" not found)`,
            });
          }
        } else {
          // Just file reference
          definitions.push({
            filePath: targetPath,
            line: 1,
            column: 1,
            name: pathPart,
            kind: "file",
          });
        }
      } else {
        // File doesn't exist
        definitions.push({
          filePath: targetPath,
          line: 1,
          column: 1,
          name: pathPart || anchor || url,
          kind: "file",
          text: "(file not found)",
        });
      }
    }

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

  private findHeadingBySlug(params: { ast: MdastRoot; slug: string }): Heading | null {
    const { ast, slug } = params;
    for (const node of ast.children) {
      if (node.type === "heading") {
        const heading = node as Heading;
        const headingText = this.extractText(heading);
        if (this.toSlug(headingText) === slug || this.toSlug(headingText) === this.toSlug(slug)) {
          return heading;
        }
      }
    }

    return null;
  }

  /**
   * Convert heading text to slug (GitHub-style).
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
        const processor = unified().use(remarkParse);
        const ast = processor.parse(content) as MdastRoot;

        const headings = this.getHeadings({ ast });
        const links = this.getLinks(ast);

        files.push({
          filePath: normalizedPath,
          fileType: "markdown",
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
   * Generate a table of contents from headings.
   * Returns Markdown-formatted TOC string.
   */
  async generateToc(params: { filePath: string; maxDepth?: number }): Promise<string> {
    const { filePath, maxDepth } = params;
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

    const headings = this.getHeadings({ ast, maxDepth });

    if (headings.length === 0) {
      return "";
    }

    // Find minimum depth to normalize indentation
    const minDepth = Math.min(...headings.map((h) => h.depth));

    const lines = headings.map((heading) => {
      const indent = "  ".repeat(heading.depth - minDepth);
      const slug = this.toSlug(heading.text);
      return `${indent}- [${heading.text}](#${slug})`;
    });

    return lines.join("\n");
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
        const processor = unified().use(remarkParse);
        const ast = processor.parse(content) as MdastRoot;

        files.push({
          filePath,
          fileType: "markdown",
          headings: this.toHeadingOverview(this.getHeadings({ ast })),
          links: this.toLinkOverview(this.getLinks(ast)),
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
   * Check links in a Markdown file.
   */
  async checkLinks(params: {
    filePath: string;
    checkExternal?: boolean;
    timeout?: number;
  }): Promise<LinkCheckResult> {
    const { filePath, checkExternal = false, timeout = 5000 } = params;
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;
    const links = this.getLinks(ast);

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
        ast,
        processor,
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
    ast: MdastRoot;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processor: any;
    checkExternal: boolean;
    timeout: number;
  }): Promise<{ status: "valid" | "broken" | "skipped"; reason?: string }> {
    const { link, filePath, ast, processor, checkExternal, timeout } = params;
    const url = link.url;

    // Same file heading reference: #heading-id
    if (url.startsWith("#")) {
      const headingId = url.slice(1);
      const targetHeading = this.findHeadingBySlug({ ast, slug: headingId });
      if (targetHeading) {
        return { status: "valid" };
      }
      return { status: "broken", reason: `heading "${headingId}" not found` };
    }

    // External URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      if (!checkExternal) {
        return { status: "skipped", reason: "external link (check_external=false)" };
      }
      return this.checkExternalUrl({ url, timeout });
    }

    // Relative file path, possibly with anchor
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
      const targetAst = processor.parse(targetContent) as MdastRoot;
      const targetHeading = this.findHeadingBySlug({ ast: targetAst, slug: anchor });

      if (targetHeading) {
        return { status: "valid" };
      }
      return { status: "broken", reason: `heading "${anchor}" not found in ${pathPart}` };
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
   * Compare structure of two Markdown files.
   * Returns added, removed, and modified headings.
   */
  async diffStructure(params: DiffStructureParams): Promise<DiffStructureResult> {
    const { filePathA, filePathB, level = "summary" } = params;

    // Get headings for both files
    const contentA = await readFile(filePathA, "utf-8");
    const contentB = await readFile(filePathB, "utf-8");
    const processor = unified().use(remarkParse);
    const astA = processor.parse(contentA) as MdastRoot;
    const astB = processor.parse(contentB) as MdastRoot;

    const headingsA = this.getHeadings({ ast: astA });
    const headingsB = this.getHeadings({ ast: astB });

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
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

    const preamble: RootContent[] = [];
    const sections: Section<RootContent>[] = [];
    let currentSection: Section<RootContent> | null = null;

    for (const node of ast.children) {
      if (node.type === "heading" && node.depth === level) {
        // Start a new section
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: this.extractText(node),
          level: node.depth,
          content: [node],
        };
      } else if (currentSection) {
        // Add to current section
        currentSection.content.push(node);
      } else {
        // Content before first heading goes to preamble
        preamble.push(node);
      }
    }

    // Don't forget the last section
    if (currentSection) {
      sections.push(currentSection);
    }

    return { preamble, sections };
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
      const cells = headers.map((h) => String(row[h] ?? ""));
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
      // eslint-disable-next-line custom/single-params-object -- array callback
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
