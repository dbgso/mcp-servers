import type { DirectoryAnalysis, FileAnalysis, StructureWarning } from "../types/index.js";

/**
 * structure_analysis's text output: one formatter per format, each with one
 * method per kind of result. formatAsTree and formatAsTable each asked
 * `"directory" in result` and held both kinds' output in one method.
 */
interface AnalysisFormatter {
  file(analysis: FileAnalysis): string;
  directory(analysis: DirectoryAnalysis): string;
}

class TreeFormatter implements AnalysisFormatter {
  file(analysis: FileAnalysis): string {
    return this.fileLines({ file: analysis, indent: 0 }).join("\n");
  }

  directory(analysis: DirectoryAnalysis): string {
    const lines = [
      `Directory: ${analysis.directory}`,
      `Files: ${analysis.fileCount}`,
      `Total words: ${analysis.aggregateMetrics.wordCount}`,
      `Total headings: ${analysis.aggregateMetrics.headingCount}`,
      `Total links: ${analysis.aggregateMetrics.linkCount}`,
      `Max depth: ${analysis.aggregateMetrics.maxDepth}`,
      "",
    ];

    for (const file of analysis.files) {
      lines.push(this.fileLines({ file, indent: 2 }).join("\n"), "");
    }

    lines.push(...warningList({ title: "Warnings:", warnings: analysis.warnings, prefix: "  " }));
    return lines.join("\n");
  }

  private fileLines(params: { file: FileAnalysis; indent: number }): string[] {
    const { file, indent } = params;
    const prefix = " ".repeat(indent);
    const lines = [
      `${prefix}${file.filePath}`,
      `${prefix}  Words: ${file.metrics.wordCount}`,
      `${prefix}  Headings: ${file.metrics.headingCount}`,
      `${prefix}  Links: ${file.metrics.linkCount}`,
      `${prefix}  Max depth: ${file.metrics.maxDepth}`,
    ];

    if (file.sections.length > 0) {
      lines.push(`${prefix}  Sections:`);
      for (const section of file.sections) {
        const sectionIndent = " ".repeat(section.level * 2);
        lines.push(`${prefix}    ${sectionIndent}${section.title} (${section.wordCount} words)`);
      }
    }

    lines.push(...warningList({ title: `${prefix}  Warnings:`, warnings: file.warnings, prefix: `${prefix}    ` }));
    return lines;
  }
}

/** `title`, then one `- [type] message` line per warning; nothing when there are none. */
function warningList(params: { title: string; warnings: StructureWarning[]; prefix: string }): string[] {
  const { title, warnings, prefix } = params;
  if (warnings.length === 0) return [];
  return [title, ...warnings.map((warning) => `${prefix}- [${warning.type}] ${warning.message}`)];
}

/** A titled Markdown table, then `after`; nothing at all when there are no rows. */
function table(params: { title: string; header: string; separator: string; rows: string[]; after?: string[] }): string[] {
  const { title, header, separator, rows, after = [] } = params;
  if (rows.length === 0) return [];
  return [title, "", header, separator, ...rows, ...after];
}

class TableFormatter implements AnalysisFormatter {
  file(analysis: FileAnalysis): string {
    const lines = [
      "## File Summary",
      "",
      `- **Path**: ${analysis.filePath}`,
      `- **Type**: ${analysis.fileType}`,
      `- **Words**: ${analysis.metrics.wordCount}`,
      `- **Headings**: ${analysis.metrics.headingCount}`,
      `- **Links**: ${analysis.metrics.linkCount}`,
      `- **Max Depth**: ${analysis.metrics.maxDepth}`,
      "",
      ...table({
        title: "## Sections",
        header: "| Section | Level | Words |",
        separator: "| --- | ---: | ---: |",
        rows: analysis.sections.map((section) => {
          const indent = "  ".repeat(section.level - 1);
          return `| ${indent}${section.title} | ${section.level} | ${section.wordCount} |`;
        }),
        after: [""],
      }),
      ...table({
        title: "## Warnings",
        header: "| Type | Message |",
        separator: "| --- | --- |",
        rows: analysis.warnings.map((warning) => `| ${warning.type} | ${warning.message} |`),
      }),
    ];
    return lines.join("\n");
  }

  directory(analysis: DirectoryAnalysis): string {
    const lines = [
      "## Directory Summary",
      "",
      `- **Path**: ${analysis.directory}`,
      `- **Files**: ${analysis.fileCount}`,
      `- **Total Words**: ${analysis.aggregateMetrics.wordCount}`,
      `- **Total Headings**: ${analysis.aggregateMetrics.headingCount}`,
      `- **Total Links**: ${analysis.aggregateMetrics.linkCount}`,
      `- **Max Depth**: ${analysis.aggregateMetrics.maxDepth}`,
      "",
      // The files table is written even when it has no rows
      "## Files",
      "",
      "| File | Words | Headings | Links | Warnings |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...analysis.files.map((file) => {
        const fileName = file.filePath.split("/").pop();
        return `| ${fileName} | ${file.metrics.wordCount} | ${file.metrics.headingCount} | ${file.metrics.linkCount} | ${file.warnings.length} |`;
      }),
      "",
      ...table({
        title: "## Warnings",
        header: "| Type | Message | Location |",
        separator: "| --- | --- | --- |",
        rows: analysis.warnings.map((warning) => `| ${warning.type} | ${warning.message} | ${warning.location?.section ?? ""} |`),
      }),
    ];
    return lines.join("\n");
  }
}

const TEXT_FORMATTERS: Record<"tree" | "table", AnalysisFormatter> = {
  tree: new TreeFormatter(),
  table: new TableFormatter(),
};

/** The analysis in a text format; the kind of result is asked once, here. */
export function formatAnalysis(params: { result: FileAnalysis | DirectoryAnalysis; format: "tree" | "table" }): string {
  const { result, format } = params;
  const formatter = TEXT_FORMATTERS[format];
  return "directory" in result ? formatter.directory(result) : formatter.file(result);
}
