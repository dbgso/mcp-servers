import { z } from "zod";
import { stat } from "node:fs/promises";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { getHandler, HANDLERS, readDocuments, type DocumentHandler } from "../../handlers/index.js";
import { findHeadingSkips } from "../heading-skips.js";
import { formatAnalysis } from "../structure-format.js";
import type {
  FileMetrics,
  SectionBreakdown,
  StructureWarning,
  FileAnalysis,
  DirectoryAnalysis,
  HeadingSummary,
} from "../../types/index.js";

const StructureAnalysisSchema = z.object({
  file_path: z.string().describe("File or directory path to analyze"),
  pattern: z
    .string()
    .optional()
    .describe("File pattern for directories (e.g., '*.md', '*.adoc')"),
  output_format: z
    .enum(["json", "tree", "table"])
    .optional()
    .default("json")
    .describe("Output format: json (structured data), tree (indented text), table (markdown table)"),
  include_warnings: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include warnings about structural issues (default: true)"),
});

type StructureAnalysisArgs = z.infer<typeof StructureAnalysisSchema>;

// Threshold for large sections (in words)
const LARGE_SECTION_THRESHOLD = 1500;

function sectionLocation(section: SectionBreakdown): StructureWarning["location"] {
  return { line: section.line, section: section.title };
}

function largeSectionWarnings(sections: SectionBreakdown[]): StructureWarning[] {
  return sections
    .filter((section) => section.wordCount > LARGE_SECTION_THRESHOLD)
    .map((section) => ({
      type: "large_section",
      message: `Section "${section.title}" has ${section.wordCount} words (threshold: ${LARGE_SECTION_THRESHOLD})`,
      location: sectionLocation(section),
    }));
}

function emptySectionWarnings(sections: SectionBreakdown[]): StructureWarning[] {
  return sections
    .filter((section) => section.wordCount === 0)
    .map((section) => ({
      type: "empty_section",
      message: `Section "${section.title}" is empty`,
      location: sectionLocation(section),
    }));
}

/** Heading hierarchy skips (e.g., h1 -> h3). */
function headingSkipWarnings(headings: HeadingSummary[]): StructureWarning[] {
  return findHeadingSkips(headings).map(({ previous, current }) => ({
    type: "heading_skip",
    message: `Heading hierarchy skip: h${previous.depth} "${previous.text}" -> h${current.depth} "${current.text}"`,
    location: { line: current.line, section: current.text },
  }));
}

/** Markdown (`#`) and AsciiDoc (`=`) heading lines. */
const HEADING_LINE_PATTERNS = [/^#+\s/, /^=+\s/];

export class StructureAnalysisHandler extends BaseToolHandler<StructureAnalysisArgs> {
  readonly name = "structure_analysis";
  readonly schema = StructureAnalysisSchema;
  readonly description =
    "Analyze document structure to support decision-making about restructuring. Returns metrics (word count, heading count, link count), section breakdown with sizes, and warnings (large sections, empty sections, heading hierarchy skips).";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "File or directory path to analyze",
      },
      pattern: {
        type: "string",
        description: "File pattern for directories (e.g., '*.md', '*.adoc')",
      },
      output_format: {
        type: "string",
        enum: ["json", "tree", "table"],
        description:
          "Output format: json (structured data), tree (indented text), table (markdown table)",
      },
      include_warnings: {
        type: "boolean",
        description: "Include warnings about structural issues (default: true)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: StructureAnalysisArgs): Promise<ToolResponse> {
    const { file_path, pattern, output_format, include_warnings } = args;

    // Check if path is file or directory
    const pathStat = await stat(file_path).catch(() => null);
    if (!pathStat) {
      return errorResponse(`Path not found: ${file_path}`);
    }

    if (pathStat.isDirectory()) {
      const read = await readDocuments({ directory: file_path, pattern });
      if ("error" in read) {
        return errorResponse(read.error);
      }
      const result = await this.analyzeDirectory({
        directory: file_path,
        files: read.files,
        includeWarnings: include_warnings,
      });
      return this.formatOutput({ result, format: output_format });
    }

    // Single file analysis
    const handler = getHandler(file_path);
    if (!handler) {
      return errorResponse(`Unsupported file type: ${file_path.split(".").pop()?.toLowerCase()}`);
    }

    const result = await this.analyzeFile({
      filePath: file_path,
      handler,
      includeWarnings: include_warnings,
    });

    return this.formatOutput({ result, format: output_format });
  }

  /**
   * Analyze a single file and return metrics, sections, and warnings.
   */
  private async analyzeFile(params: {
    filePath: string;
    handler: DocumentHandler;
    includeWarnings: boolean;
  }): Promise<FileAnalysis> {
    const { filePath, handler, includeWarnings } = params;

    // Get headings and links
    const headings = await handler.getHeadingsFromFile({ filePath });
    const links = await handler.getLinksFromFile(filePath);

    // Calculate metrics
    const metrics = this.calculateMetrics({ headings, linkCount: links.length });

    // Get sections with word counts
    const sections = await this.analyzeSections({ filePath, handler, headings });

    // Calculate total word count from sections
    metrics.wordCount = sections.reduce((sum, s) => sum + s.wordCount, 0);

    // Generate warnings
    const warnings: StructureWarning[] = includeWarnings
      ? this.generateWarnings({ headings, sections })
      : [];

    return {
      filePath,
      fileType: handler.fileType,
      metrics,
      sections,
      warnings,
    };
  }

  /**
   * Analyze a directory and return aggregated stats with per-file breakdown.
   */
  private async analyzeDirectory(params: {
    directory: string;
    files: Array<{ filePath: string; fileType: "markdown" | "asciidoc" }>;
    includeWarnings: boolean;
  }): Promise<DirectoryAnalysis> {
    const { directory, files, includeWarnings } = params;

    // Analyze each file
    const fileAnalyses: FileAnalysis[] = [];
    for (const file of files) {
      const handler = HANDLERS[file.fileType];
      const analysis = await this.analyzeFile({
        filePath: file.filePath,
        handler,
        includeWarnings,
      });
      fileAnalyses.push(analysis);
    }

    // Aggregate metrics
    const aggregateMetrics: FileMetrics = {
      wordCount: 0,
      headingCount: 0,
      maxDepth: 0,
      linkCount: 0,
    };

    for (const file of fileAnalyses) {
      aggregateMetrics.wordCount += file.metrics.wordCount;
      aggregateMetrics.headingCount += file.metrics.headingCount;
      aggregateMetrics.maxDepth = Math.max(aggregateMetrics.maxDepth, file.metrics.maxDepth);
      aggregateMetrics.linkCount += file.metrics.linkCount;
    }

    // Aggregate warnings (each file's list is already empty when warnings are off)
    const allWarnings = fileAnalyses.flatMap((f) => f.warnings);

    return {
      directory,
      aggregateMetrics,
      fileCount: fileAnalyses.length,
      files: fileAnalyses,
      warnings: allWarnings,
    };
  }

  /**
   * Calculate file metrics from headings and link count.
   */
  private calculateMetrics(params: {
    headings: HeadingSummary[];
    linkCount: number;
  }): FileMetrics {
    const { headings, linkCount } = params;

    return {
      wordCount: 0, // Will be calculated from sections
      headingCount: headings.length,
      maxDepth: headings.length > 0 ? Math.max(...headings.map((h) => h.depth)) : 0,
      linkCount,
    };
  }

  /**
   * Analyze sections and calculate word counts.
   */
  private async analyzeSections(params: {
    filePath: string;
    handler: DocumentHandler;
    headings: HeadingSummary[];
  }): Promise<SectionBreakdown[]> {
    const { filePath, handler, headings } = params;
    const sections: SectionBreakdown[] = [];

    for (const heading of headings) {
      // Get section text using the handler's getSectionText method
      const sectionText = await handler.getSectionText({
        filePath,
        headingText: heading.text,
      });

      // Calculate word count, excluding the heading line itself
      const contentText = this.extractContentWithoutHeading({
        sectionText,
        headingText: heading.text,
      });
      const wordCount = this.countWords(contentText);

      sections.push({
        title: heading.text,
        level: heading.depth,
        wordCount,
        line: heading.line,
      });
    }

    return sections;
  }

  /**
   * Extract content text without the heading line.
   */
  private extractContentWithoutHeading(params: {
    sectionText: string;
    headingText: string;
  }): string {
    const { sectionText, headingText } = params;
    const [first, ...rest] = sectionText.split("\n");

    // Skip the first line if it is the heading: a heading line, or the heading text itself
    const firstLine = first.trim();
    if (firstLine === headingText || HEADING_LINE_PATTERNS.some((pattern) => pattern.test(firstLine))) {
      return rest.join("\n");
    }

    return sectionText;
  }

  /**
   * Count words in a text string.
   */
  private countWords(text: string): number {
    if (!text.trim()) {
      return 0;
    }
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Generate warnings for structural issues.
   */
  private generateWarnings(params: {
    headings: HeadingSummary[];
    sections: SectionBreakdown[];
  }): StructureWarning[] {
    const { headings, sections } = params;
    return [...largeSectionWarnings(sections), ...emptySectionWarnings(sections), ...headingSkipWarnings(headings)];
  }

  /**
   * Format output based on the requested format.
   */
  private formatOutput(params: {
    result: FileAnalysis | DirectoryAnalysis;
    format: "json" | "tree" | "table";
  }): ToolResponse {
    const { result, format } = params;
    if (format === "json") {
      return jsonResponse(result);
    }
    return { content: [{ type: "text", text: formatAnalysis({ result, format }) }] };
  }
}
