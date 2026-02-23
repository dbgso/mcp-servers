import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";
import type {
  LintIssue,
  LintDocumentResult,
  LintRuleId,
  LintSeverity,
  HeadingSummary,
  CodeBlockSummary,
} from "../../types/index.js";

const ALL_RULES: LintRuleId[] = [
  "heading-hierarchy",
  "empty-section",
  "code-no-language",
  "duplicate-heading",
  "missing-title",
];

const RULE_SEVERITY: Record<LintRuleId, LintSeverity> = {
  "heading-hierarchy": "error",
  "empty-section": "warning",
  "code-no-language": "warning",
  "duplicate-heading": "warning",
  "missing-title": "warning",
};

const LintDocumentSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to lint"),
  rules: z
    .array(z.enum(ALL_RULES as [LintRuleId, ...LintRuleId[]]))
    .optional()
    .describe("Specific rules to check (default: all rules)"),
  severity_filter: z
    .enum(["error", "warning", "all"])
    .optional()
    .default("all")
    .describe("Filter results by severity (default: all)"),
});

type LintDocumentArgs = z.infer<typeof LintDocumentSchema>;

/**
 * Check for heading level skips (e.g., h1 -> h3 without h2)
 */
function checkHeadingHierarchy(headings: HeadingSummary[]): LintIssue[] {
  const issues: LintIssue[] = [];

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];

    // If current heading is deeper than previous by more than 1 level, it's a skip
    if (curr.depth > prev.depth + 1) {
      issues.push({
        ruleId: "heading-hierarchy",
        severity: "error",
        message: `Heading level skip: h${prev.depth} to h${curr.depth}`,
        line: curr.line,
        section: curr.text,
        suggestion: `Use h${prev.depth + 1} instead of h${curr.depth}`,
      });
    }
  }

  return issues;
}

/**
 * Check for sections with no content between headings
 */
function checkEmptySections(params: {
  headings: HeadingSummary[];
  totalLines: number;
}): LintIssue[] {
  const { headings, totalLines } = params;
  const issues: LintIssue[] = [];

  for (let i = 0; i < headings.length; i++) {
    const curr = headings[i];
    const nextLine = i + 1 < headings.length ? headings[i + 1].line : totalLines + 1;

    // Section is empty if the next heading is immediately after (within 2 lines)
    // This allows for a blank line between heading and next heading
    if (nextLine - curr.line <= 2) {
      issues.push({
        ruleId: "empty-section",
        severity: "warning",
        message: `Empty section: "${curr.text}" has no content`,
        line: curr.line,
        section: curr.text,
        suggestion: "Add content to this section or remove the heading",
      });
    }
  }

  return issues;
}

/**
 * Check for code blocks without language specification
 */
function checkCodeNoLanguage(codeBlocks: CodeBlockSummary[]): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const block of codeBlocks) {
    if (!block.lang) {
      issues.push({
        ruleId: "code-no-language",
        severity: "warning",
        message: "Code block without language specification",
        line: block.line,
        suggestion: "Add a language identifier (e.g., ```typescript, ```bash)",
      });
    }
  }

  return issues;
}

/**
 * Check for duplicate heading text at the same level
 */
function checkDuplicateHeading(headings: HeadingSummary[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const seenByLevel = new Map<number, Map<string, number>>();

  for (const heading of headings) {
    const levelMap = seenByLevel.get(heading.depth) ?? new Map<string, number>();
    const existingLine = levelMap.get(heading.text);

    if (existingLine !== undefined) {
      issues.push({
        ruleId: "duplicate-heading",
        severity: "warning",
        message: `Duplicate heading: "${heading.text}" at level h${heading.depth}`,
        line: heading.line,
        section: heading.text,
        suggestion: `Same heading text also appears at line ${existingLine}. Consider making headings unique.`,
      });
    } else {
      levelMap.set(heading.text, heading.line);
      seenByLevel.set(heading.depth, levelMap);
    }
  }

  return issues;
}

/**
 * Check if document has no h1/title
 */
function checkMissingTitle(headings: HeadingSummary[]): LintIssue[] {
  const hasTitle = headings.some((h) => h.depth === 1);

  if (!hasTitle) {
    return [
      {
        ruleId: "missing-title",
        severity: "warning",
        message: "Document has no h1 title",
        suggestion: "Add a level-1 heading at the beginning of the document",
      },
    ];
  }

  return [];
}

export class LintDocumentHandler extends BaseToolHandler<LintDocumentArgs> {
  readonly name = "lint_document";
  readonly schema = LintDocumentSchema;
  readonly description =
    "Check document quality with configurable rules. Returns issues sorted by line number with severity levels.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to lint",
      },
      rules: {
        type: "array",
        items: {
          type: "string",
          enum: ALL_RULES,
        },
        description: "Specific rules to check (default: all rules)",
      },
      severity_filter: {
        type: "string",
        enum: ["error", "warning", "all"],
        description: "Filter results by severity (default: all)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: LintDocumentArgs): Promise<ToolResponse> {
    const { file_path, rules, severity_filter } = args;
    const enabledRules = rules ?? ALL_RULES;

    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    try {
      // Get headings and code blocks for analysis
      const headings = await handler.getHeadingsFromFile({ filePath: file_path });
      const codeBlocksResult = await handler.query({
        filePath: file_path,
        queryType: "code_blocks",
      });
      const codeBlocks = codeBlocksResult.data as CodeBlockSummary[];

      // Read file to get total line count for empty section detection
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(file_path, "utf-8");
      const totalLines = content.split("\n").length;

      // Run enabled rules
      let issues: LintIssue[] = [];

      if (enabledRules.includes("heading-hierarchy")) {
        issues.push(...checkHeadingHierarchy(headings));
      }

      if (enabledRules.includes("empty-section")) {
        issues.push(...checkEmptySections({ headings, totalLines }));
      }

      if (enabledRules.includes("code-no-language")) {
        issues.push(...checkCodeNoLanguage(codeBlocks));
      }

      if (enabledRules.includes("duplicate-heading")) {
        issues.push(...checkDuplicateHeading(headings));
      }

      if (enabledRules.includes("missing-title")) {
        issues.push(...checkMissingTitle(headings));
      }

      // Filter by severity
      if (severity_filter !== "all") {
        issues = issues.filter((issue) => issue.severity === severity_filter);
      }

      // Sort by line number (issues without line go to end)
      issues.sort((a, b) => {
        const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
        const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
        return lineA - lineB;
      });

      // Calculate summary
      const errors = issues.filter((i) => i.severity === "error").length;
      const warnings = issues.filter((i) => i.severity === "warning").length;

      const result: LintDocumentResult = {
        filePath: file_path,
        issues,
        summary: {
          errors,
          warnings,
          total: issues.length,
        },
      };

      return jsonResponse(result);
    } catch (error) {
      return errorResponse(
        `Failed to lint document: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
