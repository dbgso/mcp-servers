import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Root as MdastRoot, Heading, Code, List, Link, Text, ListItem } from "mdast";
import type { GoToDefinitionResult, DefinitionLocation } from "mcp-shared";
import { BaseHandler } from "./base.js";
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
} from "../types/index.js";

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

  async query(filePath: string, queryType: QueryType, options?: { heading?: string; depth?: number }): Promise<QueryResult> {
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

    if (options?.heading) {
      const sectionAst = this.getSection(ast, options.heading);
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
          data: this.getHeadings(ast, options?.depth),
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

  getHeadings(ast: MdastRoot, maxDepth?: number): HeadingSummary[] {
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

  getSection(ast: MdastRoot, headingText: string): MdastRoot {
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

  async write(filePath: string, ast: MdastRoot): Promise<void> {
    const processor = unified().use(remarkStringify);
    const content = processor.stringify(ast);
    await writeFile(filePath, content, "utf-8");
  }

  async goToDefinition(
    filePath: string,
    line: number,
    column: number
  ): Promise<GoToDefinitionResult> {
    const content = await readFile(filePath, "utf-8");
    const processor = unified().use(remarkParse);
    const ast = processor.parse(content) as MdastRoot;

    // Find the node at the given position
    const link = this.findLinkAtPosition(ast, line, column);

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
      const targetHeading = this.findHeadingBySlug(ast, headingId);

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
          const targetHeading = this.findHeadingBySlug(targetAst, anchor);

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

  private findLinkAtPosition(ast: MdastRoot, line: number, column: number): Link | null {
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

  private findHeadingBySlug(ast: MdastRoot, slug: string): Heading | null {
    // Convert heading text to slug (simplified GitHub-style)
    const toSlug = (text: string): string => {
      return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim();
    };

    for (const node of ast.children) {
      if (node.type === "heading") {
        const heading = node as Heading;
        const headingText = this.extractText(heading);
        if (toSlug(headingText) === slug || toSlug(headingText) === toSlug(slug)) {
          return heading;
        }
      }
    }

    return null;
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
  async crawl(startFilePath: string, maxDepth: number = 10): Promise<CrawlResult> {
    const visited = new Set<string>();
    const files: FileSummary[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];

    const crawlFile = async (filePath: string, depth: number): Promise<void> => {
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

        const headings = this.getHeadings(ast);
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
            await crawlFile(targetPath, depth + 1);
          }
        }
      } catch (error) {
        errors.push({
          filePath: normalizedPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await crawlFile(startFilePath, 0);

    return {
      startFile: resolve(startFilePath),
      files,
      errors,
    };
  }

  /**
   * Find all matching files in a directory.
   */
  async findFiles(directory: string, pattern?: string): Promise<string[]> {
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
  async readDirectory(
    directory: string,
    pattern?: string
  ): Promise<{ files: FileSummary[]; errors: Array<{ filePath: string; error: string }> }> {
    const filePaths = await this.findFiles(directory, pattern);
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
          headings: this.toHeadingOverview(this.getHeadings(ast)),
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
}
