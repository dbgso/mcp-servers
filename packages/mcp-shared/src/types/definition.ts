/**
 * Common types for "go to definition" functionality across all AST MCPs.
 * Language-agnostic interface for definition lookup results.
 */

/**
 * A single definition location.
 * Represents where a symbol/reference is defined.
 */
export interface DefinitionLocation {
  /** Absolute path to the file containing the definition */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Name of the defined symbol */
  name: string;
  /**
   * Kind of definition.
   * Examples:
   * - TypeScript: function, class, interface, type, variable, method
   * - Python: function, class, method, module, variable
   * - Java: class, interface, method, field, constructor
   * - Markdown: heading, link, anchor
   * - AsciiDoc: section, anchor, include
   */
  kind: string;
  /** First line of the definition text (for preview) */
  text?: string;
}

/**
 * Result of a "go to definition" request.
 */
export interface GoToDefinitionResult {
  /** Path of the source file where the lookup was performed */
  sourceFilePath: string;
  /** Line number where the lookup was performed (1-based) */
  sourceLine: number;
  /** Column number where the lookup was performed (1-based) */
  sourceColumn: number;
  /** The identifier/symbol that was looked up */
  identifier: string;
  /** List of definition locations (may be multiple for overloads, re-exports, etc.) */
  definitions: DefinitionLocation[];
}

/**
 * A single reference location.
 * Represents where a symbol is used/referenced.
 */
export interface ReferenceLocation {
  /** Absolute path to the file containing the reference */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** The context of the reference (e.g., "import", "call", "type") */
  context: string;
  /** The line of code containing the reference (for preview) */
  text?: string;
}

/**
 * Result of a "find references" request.
 */
export interface FindReferencesResult {
  /** Path of the source file where the symbol is defined */
  definitionFilePath: string;
  /** Line number of the definition (1-based) */
  definitionLine: number;
  /** Column number of the definition (1-based) */
  definitionColumn: number;
  /** The symbol name being searched */
  symbolName: string;
  /** List of reference locations */
  references: ReferenceLocation[];
}
