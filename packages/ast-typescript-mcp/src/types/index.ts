import type { SourceFileStructure, StatementStructures } from "ts-morph";

// Re-export shared definition types
export type {
  DefinitionLocation,
  GoToDefinitionResult,
  ReferenceLocation,
  FindReferencesResult,
} from "mcp-shared";

export interface TsAstReadResult {
  filePath: string;
  fileType: "typescript";
  structure: SourceFileStructure;
}

// Query types
export type TsQueryType = "full" | "summary" | "imports" | "exports";

export type DeclarationKind = "class" | "function" | "interface" | "type" | "variable" | "enum";

export interface DeclarationSummary {
  kind: DeclarationKind;
  name: string;
  exported: boolean;
  line: number;
  members?: number; // for classes/interfaces: number of members
}

export interface ImportSummary {
  module: string;
  defaultImport?: string;
  namedImports: string[];
  namespaceImport?: string;
  line: number;
}

export interface ExportSummary {
  name: string;
  kind: DeclarationKind | "reexport";
  line: number;
}

export interface TsQueryResult {
  filePath: string;
  fileType: "typescript";
  query: TsQueryType;
  data: SourceFileStructure | DeclarationSummary[] | ImportSummary[] | ExportSummary[] | StatementStructures | null;
}

// Call Graph types
export type CallNodeKind = "function" | "method" | "class" | "arrow" | "constructor";

export interface CallGraphNode {
  /** Symbol name */
  name: string;
  /** File path where the symbol is defined */
  filePath: string;
  /** Line number of the definition */
  line: number;
  /** Kind of the symbol */
  kind: CallNodeKind;
  /** Outgoing calls from this symbol */
  calls: CallGraphNode[];
}

export interface CallGraphResult {
  /** Root node of the call graph */
  root: CallGraphNode;
  /** Total number of nodes in the graph */
  nodeCount: number;
  /** Whether max depth was reached (graph may be incomplete) */
  maxDepthReached: boolean;
}
