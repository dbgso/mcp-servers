import { readFile, writeFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Root as MdastRoot, Heading, Code, List, Link, Text, ListItem } from "mdast";
import { BaseHandler } from "./base.js";
import type {
  AstReadResult,
  HeadingSummary,
  CodeBlockSummary,
  ListSummary,
  LinkSummary,
  QueryType,
  QueryResult,
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
}
