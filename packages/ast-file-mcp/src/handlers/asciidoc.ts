import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import Asciidoctor from "@asciidoctor/core";
import { BaseHandler } from "./base.js";
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
} from "../types/index.js";

const asciidoctor = Asciidoctor();

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
    const doc = asciidoctor.load(content);

    const ast: AsciidocDocument = {
      type: "asciidoc",
      title: doc.getTitle() as string | undefined,
      blocks: this.convertBlocks(doc.getBlocks()),
    };

    return {
      filePath,
      fileType: "asciidoc",
      ast,
    };
  }

  private convertBlocks(blocks: unknown[]): AsciidocBlock[] {
    return blocks.map((block: unknown) => {
      const b = block as {
        getContext(): string;
        getContent?(): string;
        getLines?(): string[];
        getBlocks?(): unknown[];
      };

      const result: AsciidocBlock = {
        context: b.getContext(),
      };

      if (typeof b.getContent === "function") {
        result.content = b.getContent();
      }

      if (typeof b.getLines === "function") {
        result.lines = b.getLines();
      }

      if (typeof b.getBlocks === "function") {
        const nestedBlocks = b.getBlocks();
        if (nestedBlocks && nestedBlocks.length > 0) {
          result.blocks = this.convertBlocks(nestedBlocks);
        }
      }

      return result;
    });
  }

  // Note: asciidoctor.js does not support serialization back to AsciiDoc
  // write is intentionally not implemented

  /**
   * Get all headings (sections) from an AsciiDoc document.
   */
  getHeadings(doc: AsciidocDoc, maxDepth?: number): HeadingSummary[] {
    const headings: HeadingSummary[] = [];

    // Add document title as level 0 heading if present
    const title = doc.getTitle();
    if (title) {
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
        if (maxDepth && level > maxDepth) continue;

        headings.push({
          depth: level + 1, // AsciiDoc levels are 0-based, convert to 1-based
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
  async getHeadingsFromFile(filePath: string, maxDepth?: number): Promise<HeadingSummary[]> {
    const content = await readFile(filePath, "utf-8");
    const doc = asciidoctor.load(content);
    return this.getHeadings(doc, maxDepth);
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
        const doc = asciidoctor.load(content);

        const headings = this.getHeadings(doc);
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
        const doc = asciidoctor.load(content);

        files.push({
          filePath,
          fileType: "asciidoc",
          headings: this.toHeadingOverview(this.getHeadings(doc)),
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
}
