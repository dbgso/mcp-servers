import type { Root as MdastRoot } from "mdast";

// Re-export shared definition types
export type { DefinitionLocation, GoToDefinitionResult } from "mcp-shared";

export interface AstReadResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  ast: MdastRoot | AsciidocDocument;
}

export interface AsciidocDocument {
  type: "asciidoc";
  title?: string;
  docAttributes?: string[];
  blocks: AsciidocBlock[];
}

export interface AsciidocBlock {
  context: string;
  content?: string;
  lines?: string[];
  blocks?: AsciidocBlock[];
  // Extended fields for serialization
  level?: number;
  title?: string;
  style?: string;
  attributes?: Record<string, string>;
  // For list items
  marker?: string;
  text?: string;
  // Raw source (preserves markers)
  source?: string;
}

export interface FileHandler {
  readonly extensions: string[];
  readonly fileType: string;
  read(filePath: string): Promise<AstReadResult>;
  write?(params: { filePath: string; ast: unknown }): Promise<void>;
}

// Query result types
export type QueryType = "full" | "headings" | "code_blocks" | "lists" | "links";

export interface HeadingSummary {
  depth: number;
  text: string;
  line: number;
}

export interface CodeBlockSummary {
  lang: string | null;
  value: string;
  line: number;
}

export interface ListSummary {
  ordered: boolean;
  items: string[];
  line: number;
}

export interface LinkSummary {
  url: string;
  title: string | null;
  text: string;
  line: number;
}

export interface QueryResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  query: QueryType;
  data: MdastRoot | AsciidocDocument | HeadingSummary[] | CodeBlockSummary[] | ListSummary[] | LinkSummary[];
}

// Directory/Crawl summary types (without line numbers for overview)
export interface HeadingOverview {
  depth: number;
  text: string;
}

export interface LinkOverview {
  url: string;
  text: string;
}

export interface FileSummary {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  headings: HeadingOverview[];
  links: LinkOverview[];
}

export interface CrawlResult {
  startFile: string;
  files: FileSummary[];
  errors: Array<{ filePath: string; error: string }>;
}

// Link check types
export interface LinkCheckItem {
  url: string;
  text: string;
  line: number;
  reason?: string;
}

export interface LinkCheckResult {
  filePath: string;
  valid: LinkCheckItem[];
  broken: LinkCheckItem[];
  skipped: LinkCheckItem[];
}

// Placeholder types for diff-structure feature (not yet implemented in mcp-shared)
// These are added to satisfy imports that may be auto-generated
export interface DiffStructureParams {
  filePathA: string;
  filePathB: string;
  level?: "summary" | "detailed";
}

export interface DiffStructureResult {
  filePathA: string;
  filePathB: string;
  fileType: "markdown" | "asciidoc";
  added: unknown[];
  removed: unknown[];
  modified: unknown[];
  summary: string;
}

// Section manipulation types
export interface Section<T = unknown> {
  title: string;
  level: number;
  content: T[];
}

export interface SectionResult<T = unknown> {
  preamble: T[];
  sections: Section<T>[];
  title?: string;
  docAttributes?: string[];
}

export interface WriteSectionsParams<T = unknown> {
  filePath: string;
  preamble?: T[];
  sections: Section<T>[];
  docAttributes?: string[];
  title?: string;
}

export interface ReorderSectionsParams {
  filePath: string;
  targetPath?: string;
  order: string[];
  level?: number;
}

// Structure Analysis Types
export interface FileMetrics {
  wordCount: number;
  headingCount: number;
  maxDepth: number;
  linkCount: number;
}

export interface SectionBreakdown {
  title: string;
  level: number;
  wordCount: number;
  line?: number;
}

export type StructureWarningType = "large_section" | "empty_section" | "heading_skip";

export interface StructureWarning {
  type: StructureWarningType;
  message: string;
  location?: {
    line?: number;
    section?: string;
  };
}

export interface FileAnalysis {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  metrics: FileMetrics;
  sections: SectionBreakdown[];
  warnings: StructureWarning[];
}

export interface DirectoryAnalysis {
  directory: string;
  aggregateMetrics: FileMetrics;
  fileCount: number;
  files: FileAnalysis[];
  warnings: StructureWarning[];
}

export type StructureAnalysisResult = FileAnalysis | DirectoryAnalysis;

// Backlink types
export interface Backlink {
  sourceFile: string;
  sourceLine: number;
  linkText: string;
  linkUrl: string;
  context?: string;
}

export interface FindBacklinksResult {
  targetFile: string;
  targetSection?: string;
  backlinks: Backlink[];
  summary: {
    totalBacklinks: number;
    sourceFiles: number;
  };
}

// Lint document types
export type LintRuleId =
  | "heading-hierarchy"
  | "empty-section"
  | "code-no-language"
  | "duplicate-heading"
  | "missing-title";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  ruleId: LintRuleId;
  severity: LintSeverity;
  message: string;
  line?: number;
  section?: string;
  suggestion?: string;
}

export interface LintDocumentResult {
  filePath: string;
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    total: number;
  };
}
