import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { getErrorMessage } from "mcp-shared";
import type { FileHandler, AstReadResult, HeadingSummary, LinkSummary, FileSummary, CrawlResult, QueryType, QueryResult, LinkCheckResult, DiffStructureParams, DiffStructureResult, SectionResult, WriteSectionsParams, ReorderSectionsParams } from "../types/index.js";
import type { GoToDefinitionResult } from "mcp-shared";
import type { DocumentType } from "./anchor.js";
import { findFilesByExtension } from "./file-walk.js";
import {
  FileTarget,
  headingsHaveAnchor,
  LinkChecker,
  parseLinkTarget,
  toLinkCheckResult,
  type LinkCheckContext,
  type LinkedDocument,
  type LinkOutcome,
  type LinkTarget,
} from "./links.js";
import { findSectionRange } from "./sections.js";

/** The headings and links of one document: what crawl, read_directory and link_check read. */
export interface DocumentSummary {
  headings: HeadingSummary[];
  links: LinkSummary[];
}

/**
 * What both handlers do the same way, over the few things each does its own
 * way: how a document is summarised, what a heading line looks like, how a URL
 * is read, and what a same-file anchor may name.
 *
 * crawl, findFiles, readDirectory, checkLinks and getSectionText used to be
 * written out in each handler, findFiles and checkExternalUrl byte for byte.
 */
export abstract class BaseHandler implements FileHandler, LinkedDocument {
  abstract readonly extensions: string[];
  abstract readonly fileType: DocumentType;
  abstract readonly anchorNoun: string;

  /** A heading line in source: depth markers in group 1, text in group 2. */
  protected abstract readonly headingLine: RegExp;

  abstract read(filePath: string): Promise<AstReadResult>;

  write?(params: { filePath: string; ast: unknown }): Promise<void>;

  /** The headings and links of a document's source. */
  protected abstract summarize(content: string): DocumentSummary;

  /**
   * Query specific elements from a file.
   * Polymorphic method - each handler implements supported query types.
   */
  abstract query(params: {
    filePath: string;
    queryType: QueryType;
    options?: { heading?: string; depth?: number };
  }): Promise<QueryResult>;

  /**
   * Get headings from a file.
   */
  abstract getHeadingsFromFile(params: { filePath: string; maxDepth?: number }): Promise<HeadingSummary[]>;

  /**
   * Get links from a file.
   */
  abstract getLinksFromFile(filePath: string): Promise<LinkSummary[]>;

  /**
   * Generate a table of contents.
   */
  abstract generateToc(params: { filePath: string; maxDepth?: number }): Promise<string>;

  /**
   * Compare structure of two files.
   */
  abstract diffStructure(params: DiffStructureParams): Promise<DiffStructureResult>;

  /**
   * Go to definition: find where a link points to.
   * Throws if not supported for this file type.
   */
  abstract goToDefinition(params: {
    filePath: string;
    line: number;
    column: number;
  }): Promise<GoToDefinitionResult>;

  /**
   * Extract sections as independent manipulable units.
   * Returns preamble (content before first section) and sections array.
   */
  abstract getSections(params: { filePath: string; level?: number }): Promise<SectionResult>;

  /**
   * Write document from sections array.
   * Allows flexible composition of sections in any order.
   */
  abstract writeSections(params: WriteSectionsParams): Promise<void>;

  /**
   * Get section content as plain text (for AI-friendly output).
   * Returns empty string if heading not found.
   */
  async getSectionText(params: { filePath: string; headingText: string }): Promise<string> {
    const { filePath, headingText } = params;
    const lines = (await readFile(filePath, "utf-8")).split("\n");
    const range = findSectionRange({ items: lines, headingOf: (line) => this.headingOfLine(line), headingText });
    if (!range) return "";
    return lines.slice(range.start, range.end).join("\n").trim();
  }

  private headingOfLine(line: string): { depth: number; text: string } | undefined {
    const match = line.match(this.headingLine);
    return match ? { depth: match[1].length, text: match[2].trim() } : undefined;
  }

  /**
   * Find all matching files in a directory.
   */
  findFiles(params: { directory: string; pattern?: string }): Promise<string[]> {
    const { directory, pattern } = params;
    const extensions = pattern ? [pattern.replace("*.", "")] : this.extensions;
    return findFilesByExtension({ directory, extensions });
  }

  /**
   * Read all files in a directory and return summaries.
   */
  async readDirectory(params: {
    directory: string;
    pattern?: string;
  }): Promise<{ files: FileSummary[]; errors: Array<{ filePath: string; error: string }> }> {
    const filePaths = await this.findFiles(params);
    const files: FileSummary[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];

    for (const filePath of filePaths) {
      try {
        files.push(this.toFileSummary({ filePath, summary: this.summarize(await readFile(filePath, "utf-8")) }));
      } catch (error) {
        errors.push({ filePath, error: getErrorMessage(error) });
      }
    }

    return { files, errors };
  }

  /**
   * Crawl from a starting file, following links recursively.
   */
  async crawl(params: { startFile: string; maxDepth?: number }): Promise<CrawlResult> {
    const { startFile, maxDepth = 10 } = params;
    const visited = new Set<string>();
    const files: FileSummary[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];

    const crawlFile = async (params: { filePath: string; depth: number }): Promise<void> => {
      const { filePath, depth } = params;
      const normalizedPath = resolve(filePath);
      if (depth > maxDepth || visited.has(normalizedPath)) return;
      visited.add(normalizedPath);

      if (!existsSync(normalizedPath)) {
        errors.push({ filePath: normalizedPath, error: "File not found" });
        return;
      }

      try {
        const summary = this.summarize(await readFile(normalizedPath, "utf-8"));
        files.push(this.toFileSummary({ filePath: normalizedPath, summary }));
        for (const next of this.followedLinks({ filePath: normalizedPath, links: summary.links })) {
          await crawlFile({ filePath: next, depth: depth + 1 });
        }
      } catch (error) {
        errors.push({ filePath: normalizedPath, error: getErrorMessage(error) });
      }
    };

    await crawlFile({ filePath: startFile, depth: 0 });

    return { startFile: resolve(startFile), files, errors };
  }

  /** The files of this type that `links` lead to; external and same-file links are not followed. */
  private followedLinks(params: { filePath: string; links: LinkSummary[] }): string[] {
    return params.links
      .map((link) => parseLinkTarget(link.url))
      .filter((target): target is FileTarget => target instanceof FileTarget && target.pathPart !== "")
      .map((target) => target.resolveFrom(params.filePath))
      .filter((path) => this.extensions.includes(extname(path).toLowerCase().slice(1)));
  }

  /**
   * Check links in a file.
   */
  async checkLinks(params: {
    filePath: string;
    checkExternal?: boolean;
    timeout?: number;
  }): Promise<LinkCheckResult> {
    const { filePath, checkExternal = false, timeout = 5000 } = params;
    const { headings, links } = this.summarize(await readFile(filePath, "utf-8"));
    const checker = new LinkChecker({ filePath, headings, checkExternal, timeout, document: this });

    const checked = [];
    for (const link of links) {
      checked.push({ link, outcome: await this.linkTarget(link.url).accept(checker) });
    }
    return toLinkCheckResult({ filePath, checked });
  }

  /** What a URL in this kind of document points at. */
  protected linkTarget(url: string): LinkTarget {
    return parseLinkTarget(url);
  }

  headingsOf(content: string): HeadingSummary[] {
    return this.summarize(content).headings;
  }

  checkSameFileAnchor(params: { anchor: string; context: LinkCheckContext }): LinkOutcome {
    const { anchor, context } = params;
    if (headingsHaveAnchor({ headings: context.headings, anchor, fileType: this.fileType })) {
      return { status: "valid" };
    }
    return { status: "broken", reason: `${this.anchorNoun} "${anchor}" not found` };
  }

  /** A summary without line numbers or titles, as the overview tools report it. */
  private toFileSummary(params: { filePath: string; summary: DocumentSummary }): FileSummary {
    const { filePath, summary } = params;
    return {
      filePath,
      fileType: this.fileType,
      headings: summary.headings.map(({ depth, text }) => ({ depth, text })),
      links: summary.links.map(({ url, text }) => ({ url, text })),
    };
  }

  /**
   * Reorder sections by title.
   * Convenience method built on getSections() and writeSections().
   */
  async reorderSections(params: ReorderSectionsParams): Promise<void> {
    const { preamble, sections, title, docAttributes } = await this.getSections({
      filePath: params.filePath,
      level: params.level,
    });

    // Create a map for quick lookup
    const sectionMap = new Map(sections.map(s => [s.title, s]));

    // Build ordered sections
    const ordered = [];
    for (const t of params.order) {
      const section = sectionMap.get(t);
      if (section) {
        ordered.push(section);
        sectionMap.delete(t);
      }
    }

    // Append remaining sections not in the order list
    for (const section of sectionMap.values()) {
      ordered.push(section);
    }

    await this.writeSections({
      filePath: params.targetPath ?? params.filePath,
      preamble,
      sections: ordered,
      title,
      docAttributes,
    });
  }

  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return this.extensions.includes(ext);
  }
}
