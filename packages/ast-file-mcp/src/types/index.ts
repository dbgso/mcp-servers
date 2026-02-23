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
