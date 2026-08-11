import type { FileHandler, AstReadResult, HeadingSummary, LinkSummary, FileSummary, CrawlResult, QueryType, QueryResult, LinkCheckResult, DiffStructureParams, DiffStructureResult, SectionResult, WriteSectionsParams, ReorderSectionsParams } from "../types/index.js";
import type { GoToDefinitionResult } from "mcp-shared";

export abstract class BaseHandler implements FileHandler {
  abstract readonly extensions: string[];
  abstract readonly fileType: string;

  abstract read(filePath: string): Promise<AstReadResult>;

  write?(params: { filePath: string; ast: unknown }): Promise<void>;

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
   * Get section content as plain text.
   * Returns empty string if heading not found.
   */
  abstract getSectionText(params: { filePath: string; headingText: string }): Promise<string>;

  /**
   * Get headings from a file.
   */
  abstract getHeadingsFromFile(params: { filePath: string; maxDepth?: number }): Promise<HeadingSummary[]>;

  /**
   * Get links from a file.
   */
  abstract getLinksFromFile(filePath: string): Promise<LinkSummary[]>;

  /**
   * Read all files in a directory and return summaries.
   */
  abstract readDirectory(params: {
    directory: string;
    pattern?: string;
  }): Promise<{ files: FileSummary[]; errors: Array<{ filePath: string; error: string }> }>;

  /**
   * Crawl from a starting file, following links recursively.
   */
  abstract crawl(params: { startFile: string; maxDepth?: number }): Promise<CrawlResult>;

  /**
   * Check links in a file.
   */
  abstract checkLinks(params: {
    filePath: string;
    checkExternal?: boolean;
    timeout?: number;
  }): Promise<LinkCheckResult>;

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
