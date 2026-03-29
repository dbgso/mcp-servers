import { z } from "zod";
import { stat } from "node:fs/promises";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { MarkdownHandler, AsciidocHandler } from "../../handlers/index.js";
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
    const { file_path, pattern, output_format = "json", include_warnings = true } = args;

    // Check if path is file or directory
    const pathStat = await stat(file_path).catch(() => null);
    if (!pathStat) {
      return errorResponse(`Path not found: ${file_path}`);
    }

    const mdHandler = new MarkdownHandler();
    const adocHandler = new AsciidocHandler();

    if (pathStat.isDirectory()) {
      // Directory analysis
      const result = await this.analyzeDirectory({
        directory: file_path,
        pattern,
        mdHandler,
        adocHandler,
        includeWarnings: include_warnings,
      });
      return this.formatOutput({ result, format: output_format, isDirectory: true });
    }

    // Single file analysis
    const ext = file_path.split(".").pop()?.toLowerCase() ?? "";
    let handler: MarkdownHandler | AsciidocHandler;

    if (mdHandler.extensions.includes(ext)) {
      handler = mdHandler;
    } else if (adocHandler.extensions.includes(ext)) {
      handler = adocHandler;
    } else {
      return errorResponse(`Unsupported file type: ${ext}`);
    }

    const result = await this.analyzeFile({
      filePath: file_path,
      handler,
      includeWarnings: include_warnings,
    });

    return this.formatOutput({ result, format: output_format, isDirectory: false });
  }

  /**
   * Analyze a single file and return metrics, sections, and warnings.
   */
  private async analyzeFile(params: {
    filePath: string;
    handler: MarkdownHandler | AsciidocHandler;
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
      fileType: handler.fileType as "markdown" | "asciidoc",
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
    pattern?: string;
    mdHandler: MarkdownHandler;
    adocHandler: AsciidocHandler;
    includeWarnings: boolean;
  }): Promise<DirectoryAnalysis> {
    const { directory, pattern, mdHandler, adocHandler, includeWarnings } = params;

    // Read directory using handlers
    let files: { filePath: string; fileType: "markdown" | "asciidoc" }[] = [];

    if (pattern) {
      const ext = pattern.replace("*.", "").toLowerCase();
      if (mdHandler.extensions.includes(ext)) {
        const result = await mdHandler.readDirectory({ directory, pattern });
        files = result.files.map((f) => ({ filePath: f.filePath, fileType: f.fileType }));
      } else if (adocHandler.extensions.includes(ext)) {
        const result = await adocHandler.readDirectory({ directory, pattern });
        files = result.files.map((f) => ({ filePath: f.filePath, fileType: f.fileType }));
      }
    } else {
      const [mdResult, adocResult] = await Promise.all([
        mdHandler.readDirectory({ directory }),
        adocHandler.readDirectory({ directory }),
      ]);
      files = [
        ...mdResult.files.map((f) => ({ filePath: f.filePath, fileType: f.fileType })),
        ...adocResult.files.map((f) => ({ filePath: f.filePath, fileType: f.fileType })),
      ];
    }

    // Analyze each file
    const fileAnalyses: FileAnalysis[] = [];
    for (const file of files) {
      const handler = file.fileType === "markdown" ? mdHandler : adocHandler;
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

    // Aggregate warnings
    const allWarnings: StructureWarning[] = includeWarnings
      ? fileAnalyses.flatMap((f) => f.warnings)
      : [];

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
    handler: MarkdownHandler | AsciidocHandler;
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
    const lines = sectionText.split("\n");

    // Skip the first line if it's the heading
    // Markdown: starts with # or =
    // AsciiDoc: starts with = or matches the heading text
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      // Check for Markdown heading (# or ## etc.)
      const isMarkdownHeading = /^#+\s/.test(firstLine);
      // Check for AsciiDoc heading (= or == etc.)
      const isAsciidocHeading = /^=+\s/.test(firstLine);
      // Or if the first line is exactly the heading text
      const isPlainHeading = firstLine === headingText;

      if (isMarkdownHeading || isAsciidocHeading || isPlainHeading) {
        return lines.slice(1).join("\n");
      }
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
    const warnings: StructureWarning[] = [];

    // Check for large sections
    for (const section of sections) {
      if (section.wordCount > LARGE_SECTION_THRESHOLD) {
        warnings.push({
          type: "large_section",
          message: `Section "${section.title}" has ${section.wordCount} words (threshold: ${LARGE_SECTION_THRESHOLD})`,
          location: {
            line: section.line,
            section: section.title,
          },
        });
      }
    }

    // Check for empty sections
    for (const section of sections) {
      if (section.wordCount === 0) {
        warnings.push({
          type: "empty_section",
          message: `Section "${section.title}" is empty`,
          location: {
            line: section.line,
            section: section.title,
          },
        });
      }
    }

    // Check for heading hierarchy skips (e.g., h1 -> h3)
    for (let i = 1; i < headings.length; i++) {
      const prevDepth = headings[i - 1].depth;
      const currDepth = headings[i].depth;

      // Skip is when we go deeper by more than 1 level
      if (currDepth > prevDepth + 1) {
        warnings.push({
          type: "heading_skip",
          message: `Heading hierarchy skip: h${prevDepth} "${headings[i - 1].text}" -> h${currDepth} "${headings[i].text}"`,
          location: {
            line: headings[i].line,
            section: headings[i].text,
          },
        });
      }
    }

    return warnings;
  }

  /**
   * Format output based on the requested format.
   */
  private formatOutput(params: {
    result: FileAnalysis | DirectoryAnalysis;
    format: "json" | "tree" | "table";
    isDirectory: boolean;
  }): ToolResponse {
    const { result, format } = params;

    if (format === "json") {
      return jsonResponse(result);
    }

    if (format === "tree") {
      const text = this.formatAsTree(result);
      return {
        content: [{ type: "text", text }],
      };
    }

    // format === "table"
    const text = this.formatAsTable(result);
    return {
      content: [{ type: "text", text }],
    };
  }

  /**
   * Format result as indented tree structure.
   */
  private formatAsTree(result: FileAnalysis | DirectoryAnalysis): string {
    const lines: string[] = [];

    // Check if directory analysis
    if ("directory" in result) {
      lines.push(`Directory: ${result.directory}`);
      lines.push(`Files: ${result.fileCount}`);
      lines.push(`Total words: ${result.aggregateMetrics.wordCount}`);
      lines.push(`Total headings: ${result.aggregateMetrics.headingCount}`);
      lines.push(`Total links: ${result.aggregateMetrics.linkCount}`);
      lines.push(`Max depth: ${result.aggregateMetrics.maxDepth}`);
      lines.push("");

      for (const file of result.files) {
        lines.push(this.formatFileAsTree({ file, indent: 2 }));
        lines.push("");
      }

      if (result.warnings.length > 0) {
        lines.push("Warnings:");
        for (const warning of result.warnings) {
          lines.push(`  - [${warning.type}] ${warning.message}`);
        }
      }
    } else {
      lines.push(this.formatFileAsTree({ file: result, indent: 0 }));
    }

    return lines.join("\n");
  }

  /**
   * Format a single file analysis as tree.
   */
  private formatFileAsTree(params: { file: FileAnalysis; indent: number }): string {
    const { file, indent } = params;
    const prefix = " ".repeat(indent);
    const lines: string[] = [];

    lines.push(`${prefix}${file.filePath}`);
    lines.push(`${prefix}  Words: ${file.metrics.wordCount}`);
    lines.push(`${prefix}  Headings: ${file.metrics.headingCount}`);
    lines.push(`${prefix}  Links: ${file.metrics.linkCount}`);
    lines.push(`${prefix}  Max depth: ${file.metrics.maxDepth}`);

    if (file.sections.length > 0) {
      lines.push(`${prefix}  Sections:`);
      for (const section of file.sections) {
        const sectionIndent = " ".repeat(section.level * 2);
        lines.push(`${prefix}    ${sectionIndent}${section.title} (${section.wordCount} words)`);
      }
    }

    if (file.warnings.length > 0) {
      lines.push(`${prefix}  Warnings:`);
      for (const warning of file.warnings) {
        lines.push(`${prefix}    - [${warning.type}] ${warning.message}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format result as markdown table.
   */
  private formatAsTable(result: FileAnalysis | DirectoryAnalysis): string {
    const lines: string[] = [];

    // Check if directory analysis
    if ("directory" in result) {
      lines.push("## Directory Summary");
      lines.push("");
      lines.push(`- **Path**: ${result.directory}`);
      lines.push(`- **Files**: ${result.fileCount}`);
      lines.push(`- **Total Words**: ${result.aggregateMetrics.wordCount}`);
      lines.push(`- **Total Headings**: ${result.aggregateMetrics.headingCount}`);
      lines.push(`- **Total Links**: ${result.aggregateMetrics.linkCount}`);
      lines.push(`- **Max Depth**: ${result.aggregateMetrics.maxDepth}`);
      lines.push("");

      // Files table
      lines.push("## Files");
      lines.push("");
      lines.push("| File | Words | Headings | Links | Warnings |");
      lines.push("| --- | ---: | ---: | ---: | ---: |");
      for (const file of result.files) {
        const fileName = file.filePath.split("/").pop() ?? file.filePath;
        lines.push(
          `| ${fileName} | ${file.metrics.wordCount} | ${file.metrics.headingCount} | ${file.metrics.linkCount} | ${file.warnings.length} |`
        );
      }
      lines.push("");

      // Warnings table
      if (result.warnings.length > 0) {
        lines.push("## Warnings");
        lines.push("");
        lines.push("| Type | Message | Location |");
        lines.push("| --- | --- | --- |");
        for (const warning of result.warnings) {
          const location = warning.location?.section ?? "";
          lines.push(`| ${warning.type} | ${warning.message} | ${location} |`);
        }
      }
    } else {
      lines.push("## File Summary");
      lines.push("");
      lines.push(`- **Path**: ${result.filePath}`);
      lines.push(`- **Type**: ${result.fileType}`);
      lines.push(`- **Words**: ${result.metrics.wordCount}`);
      lines.push(`- **Headings**: ${result.metrics.headingCount}`);
      lines.push(`- **Links**: ${result.metrics.linkCount}`);
      lines.push(`- **Max Depth**: ${result.metrics.maxDepth}`);
      lines.push("");

      // Sections table
      if (result.sections.length > 0) {
        lines.push("## Sections");
        lines.push("");
        lines.push("| Section | Level | Words |");
        lines.push("| --- | ---: | ---: |");
        for (const section of result.sections) {
          const indent = "  ".repeat(section.level - 1);
          lines.push(`| ${indent}${section.title} | ${section.level} | ${section.wordCount} |`);
        }
        lines.push("");
      }

      // Warnings table
      if (result.warnings.length > 0) {
        lines.push("## Warnings");
        lines.push("");
        lines.push("| Type | Message |");
        lines.push("| --- | --- |");
        for (const warning of result.warnings) {
          lines.push(`| ${warning.type} | ${warning.message} |`);
        }
      }
    }

    return lines.join("\n");
  }
}
