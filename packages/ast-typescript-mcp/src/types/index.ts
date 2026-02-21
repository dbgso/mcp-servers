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
