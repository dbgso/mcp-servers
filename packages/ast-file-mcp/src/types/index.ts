import type { Root as MdastRoot } from "mdast";

export interface AstReadResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  ast: MdastRoot | AsciidocDocument;
}

export interface AsciidocDocument {
  type: "asciidoc";
  title?: string;
  blocks: AsciidocBlock[];
}

export interface AsciidocBlock {
  context: string;
  content?: string;
  lines?: string[];
  blocks?: AsciidocBlock[];
}

export interface FileHandler {
  readonly extensions: string[];
  readonly fileType: string;
  read(filePath: string): Promise<AstReadResult>;
  write?(filePath: string, ast: unknown): Promise<void>;
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
