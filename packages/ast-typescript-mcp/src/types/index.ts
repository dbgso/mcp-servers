import type { SourceFileStructure, StatementStructures, InterfaceDeclarationStructure } from "ts-morph";

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

export interface ParamInfo {
  name: string;
  type: string;
  optional?: boolean;
}

export interface MethodSummary {
  name: string;
  line: number;
  column: number;
  params: ParamInfo[];
  signature: string;
}

export interface DeclarationSummary {
  kind: DeclarationKind;
  name: string;
  exported: boolean;
  line: number;
  column?: number;
  params?: ParamInfo[];  // for functions
  signature?: string;    // for functions
  members?: number;      // for classes/interfaces: number of members
  methods?: MethodSummary[];  // for classes: method details
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

// Type Hierarchy types
export type TypeHierarchyDirection = "ancestors" | "descendants" | "both";

export type TypeHierarchyNodeKind = "class" | "interface";

export type TypeHierarchyRelation = "extends" | "implements" | "derivedBy";

export interface TypeHierarchyNode {
  /** Name of the type */
  name: string;
  /** File path where the type is defined */
  filePath: string;
  /** Line number of the definition */
  line: number;
  /** Kind of the type (class or interface) */
  kind: TypeHierarchyNodeKind;
  /** Relation to the parent in the hierarchy */
  relation?: TypeHierarchyRelation;
  /** Whether this type is from an external library (node_modules) */
  isExternal?: boolean;
  /** Child nodes in the hierarchy (ancestors or descendants depending on direction) */
  children: TypeHierarchyNode[];
}

export interface TypeHierarchyResult {
  /** Root node representing the type at the cursor position */
  root: TypeHierarchyNode;
  /** Direction of traversal */
  direction: TypeHierarchyDirection;
  /** Total number of nodes in the hierarchy */
  nodeCount: number;
  /** Whether max depth was reached (hierarchy may be incomplete) */
  maxDepthReached: boolean;
}

// Rename Symbol types
export interface RenameLocation {
  /** File path where the rename occurred */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Original text that was/will be renamed */
  originalText: string;
  /** Context of the reference (import, call, type, etc.) */
  context: string;
}

export interface RenameSymbolResult {
  /** Original symbol name */
  oldName: string;
  /** New symbol name */
  newName: string;
  /** Whether this was a dry run (no files modified) */
  dryRun: boolean;
  /** Locations where the symbol was/will be renamed */
  locations: RenameLocation[];
  /** Files that were/will be modified */
  modifiedFiles: string[];
  /** Total number of occurrences renamed */
  totalOccurrences: number;
}

// Dead code detection types
export type DeadCodeKind = "export" | "private_member";

export interface DeadCodeSymbol {
  /** Symbol name */
  name: string;
  /** File path where the symbol is defined */
  filePath: string;
  /** Line number of the definition */
  line: number;
  /** Kind of dead code: export or private_member */
  kind: DeadCodeKind;
  /** Declaration kind (function, class, variable, etc.) */
  declarationKind: DeclarationKind | "method" | "property";
}

export interface DeadCodeResult {
  /** Unused symbols found */
  deadSymbols: DeadCodeSymbol[];
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Number of exports checked */
  exportsChecked: number;
  /** Number of private members checked */
  privateMembersChecked: number;
}

// Extract Interface types
export interface ExtractInterfaceResult {
  /** File path of the source class */
  filePath: string;
  /** Name of the source class */
  className: string;
  /** Name of the generated interface */
  interfaceName: string;
  /** The generated interface structure */
  interfaceStructure: InterfaceDeclarationStructure;
}

// Re-export InterfaceDeclarationStructure for external use
export type { InterfaceDeclarationStructure };

// Dependency Graph types

/** A node in the dependency graph representing a module */
export interface DependencyNode {
  /** Absolute file path of the module */
  filePath: string;
  /** Whether this is an external module (from node_modules) */
  isExternal: boolean;
}

/** An edge in the dependency graph representing an import relationship */
export interface DependencyEdge {
  /** Path of the importing module */
  from: string;
  /** Path of the imported module */
  to: string;
  /** Import specifiers (named imports, default, namespace) */
  specifiers: string[];
}

/** A cycle in the dependency graph */
export interface DependencyCycle {
  /** File paths forming the cycle, in order */
  nodes: string[];
}

/** Parameters for getDependencyGraph */
export interface DependencyGraphParams {
  /** Directory to analyze */
  directory: string;
  /** Glob pattern to filter files (default: "**\/*.{ts,tsx}") */
  pattern?: string;
  /** Include external dependencies from node_modules (default: false) */
  includeExternal?: boolean;
}

/** Result of dependency graph analysis */
export interface DependencyGraphResult {
  /** All nodes (modules) in the graph */
  nodes: DependencyNode[];
  /** All edges (import relationships) in the graph */
  edges: DependencyEdge[];
  /** Detected cycles in the dependency graph */
  cycles: DependencyCycle[];
}

// Re-export diff types from mcp-shared
export type {
  DiffableItem,
  DiffChange,
  DiffResult,
  DiffOptions,
} from "mcp-shared";

/** Parameters for diffStructure */
export interface DiffStructureParams {
  /** Path to the first TypeScript file */
  filePathA: string;
  /** Path to the second TypeScript file */
  filePathB: string;
  /** Comparison level: summary (name+kind) or detailed (includes properties) */
  level?: "summary" | "detailed";
}

/** Result of structure diff comparison */
export interface DiffStructureResult {
  /** Path to the first file */
  filePathA: string;
  /** Path to the second file */
  filePathB: string;
  /** File type being compared */
  fileType: "typescript";
  /** Items added in file B */
  added: import("mcp-shared").DiffChange[];
  /** Items removed from file A */
  removed: import("mcp-shared").DiffChange[];
  /** Items modified between A and B */
  modified: import("mcp-shared").DiffChange[];
  /** Human-readable summary */
  summary: string;
}

// Type Check types
export type DiagnosticSeverity = "error" | "warning" | "suggestion" | "message";

export interface TypeCheckDiagnostic {
  /** Error/warning message */
  message: string;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Error code (e.g., 2322 for type mismatch) */
  code: number;
  /** File path where the error occurred */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Length of the error span */
  length?: number;
  /** Source text at the error location (first 100 chars) */
  sourceText?: string;
}

export interface TypeCheckResult {
  /** File path that was checked */
  filePath: string;
  /** All diagnostics found */
  diagnostics: TypeCheckDiagnostic[];
  /** Number of errors */
  errorCount: number;
  /** Number of warnings */
  warningCount: number;
  /** Number of suggestions (if include_suggestions was true) */
  suggestionCount: number;
  /** Whether the file has no type errors */
  success: boolean;
}

// Auto Import types
export interface AddedImport {
  /** Module specifier (e.g., "react", "./utils") */
  module: string;
  /** Default import name if added */
  defaultImport?: string;
  /** Named imports that were added */
  namedImports?: string[];
  /** Namespace import if added */
  namespaceImport?: string;
  /** Whether this is a completely new import declaration */
  isNew: boolean;
}

export interface AutoImportResult {
  /** File path that was processed */
  filePath: string;
  /** Whether this was a dry run (no files modified) */
  dryRun: boolean;
  /** List of imports that were/will be added */
  addedImports: AddedImport[];
  /** Total number of imports added */
  totalAdded: number;
  /** Warnings about ambiguous imports or other issues */
  warnings?: string[];
}

// Inline Type types
export interface InlineTypeResult {
  /** File path */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Identifier at cursor position */
  identifier: string;
  /** Original type expression (may include alias name) */
  originalType: string;
  /** Expanded type expression */
  expandedType: string;
  /** Type alias name if applicable */
  aliasName?: string;
  /** Whether expansion was performed */
  isExpanded: boolean;
}

// Query graph types
export type QueryGraphSource = "dependency" | "call_graph";
export type QueryGraphPreset = "top_referenced" | "top_importers" | "orphans" | "coupling" | "modules";

export interface QueryGraphParams {
  source: QueryGraphSource;
  directory: string;
  jq?: string;
  preset?: QueryGraphPreset;
}

export interface QueryGraphResult {
  source: QueryGraphSource;
  query: string;
  result: unknown;
}

// Refactoring tools types

/** Parameters for extract_common_interface */
export interface ExtractCommonInterfaceParams {
  /** Source files containing classes (glob pattern or paths) */
  sourceFiles: string | string[];
  /** Name for the generated interface */
  interfaceName: string;
  /** Pattern to match class names (regex, optional) */
  classPattern?: string;
  /** Include methods (default: true) */
  includeMethods?: boolean;
  /** Include properties (default: true) */
  includeProperties?: boolean;
  /** Minimum occurrence ratio for a member to be included (0-1, default: 0.5) */
  minOccurrence?: number;
}

/** Member found in common across classes */
export interface CommonMember {
  /** Member name */
  name: string;
  /** Member kind (method or property) */
  kind: "method" | "property";
  /** Type signature */
  type: string;
  /** Number of classes containing this member */
  occurrences: number;
  /** Class names containing this member */
  foundIn: string[];
}

/** Result of common interface extraction */
export interface ExtractCommonInterfaceResult {
  /** Generated interface name */
  interfaceName: string;
  /** Classes analyzed */
  analyzedClasses: string[];
  /** Common members found */
  commonMembers: CommonMember[];
  /** Generated interface structure */
  interfaceStructure: InterfaceDeclarationStructure;
  /** Total classes analyzed */
  totalClasses: number;
  /** Total common members found */
  totalCommonMembers: number;
}

