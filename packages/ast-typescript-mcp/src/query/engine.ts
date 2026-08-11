/**
 * Shared AST query engine for query_ast and transform_ast.
 */

import { Node, SyntaxKind, Project } from "ts-morph";
import type { SourceFile } from "ts-morph";
import { glob } from "glob";
import { resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Base query properties (nested queries may omit kind if using $text or $any) */
export interface AstQueryBase {
  kind?: string;
  $capture?: string;
  $text?: string;
  $any?: true;
  [key: string]: AstQueryBase | string | boolean | undefined;
}

/** Root query requires kind */
export interface AstQuery extends AstQueryBase {
  kind: string;
}

/** A single match with captured values */
export interface QueryMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  kind: string;
  node: Node;
  captures: Record<string, CapturedNode>;
}

/** Captured node info */
export interface CapturedNode {
  text: string;
  line: number;
  column: number;
  node: Node;
}

/** Search options */
export interface SearchOptions {
  searchPath: string;
  query: AstQuery;
  include?: string[];
  exclude?: string[];
  limit?: number;
}

/** Search result */
export interface SearchResult {
  matches: QueryMatch[];
  totalFiles: number;
  filesWithMatches: number;
  truncated: boolean;
}

// ─── Query Engine ─────────────────────────────────────────────────────────────

export class QueryEngine {
  private project: Project;

  constructor() {
    this.project = new Project({ skipAddingFilesFromTsConfig: true });
  }

  /** Search for AST patterns in files */
  async search(options: SearchOptions): Promise<SearchResult> {
    const {
      searchPath,
      query,
      include = ["**/*.ts", "**/*.tsx"],
      exclude = ["**/node_modules/**", "**/*.d.ts"],
      limit = 100,
    } = options;

    const files = await this.findFiles({ searchPath, include, exclude });
    if (files.length === 0) {
      return { matches: [], totalFiles: 0, filesWithMatches: 0, truncated: false };
    }

    const allMatches: QueryMatch[] = [];
    let filesWithMatches = 0;
    let truncated = false;

    for (const file of files) {
      if (allMatches.length >= limit) {
        truncated = true;
        break;
      }

      const sourceFile = this.project.addSourceFileAtPath(file);
      const remainingLimit = limit - allMatches.length;
      const matches = this.searchFile({ sourceFile, query, limit: remainingLimit });

      if (matches.length > 0) {
        filesWithMatches++;
        allMatches.push(...matches);
      }

      if (matches.length >= remainingLimit) {
        truncated = true;
      }

      this.project.removeSourceFile(sourceFile);
    }

    return {
      matches: allMatches,
      totalFiles: files.length,
      filesWithMatches,
      truncated,
    };
  }

  /** Search a single source file */
  searchFile(params: {
    sourceFile: SourceFile;
    query: AstQuery;
    limit: number;
  }): QueryMatch[] {
    const { sourceFile, query, limit } = params;
    const matches: QueryMatch[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (matches.length >= limit) {
        return false;
      }

      const captures: Record<string, CapturedNode> = {};
      if (this.matchNode({ node, query, captures, sourceFile })) {
        const text = node.getText();
        const pos = sourceFile.getLineAndColumnAtPos(node.getStart());
        matches.push({
          file: filePath,
          line: pos.line,
          column: pos.column,
          text: text.length > 200 ? text.slice(0, 200) + "..." : text,
          kind: node.getKindName(),
          node,
          captures,
        });
      }

      return undefined;
    });

    return matches;
  }

  /** Match a node against a query */
  matchNode(params: {
    node: Node;
    query: AstQueryBase;
    captures: Record<string, CapturedNode>;
    sourceFile: SourceFile;
  }): boolean {
    const { node, query, captures, sourceFile } = params;

    // Match $any - matches any node
    if (query.$any === true) {
      this.captureIfNeeded({ node, query, captures, sourceFile });
      return true;
    }

    // Match kind (required for root query, optional for nested)
    const expectedKind = query.kind;
    if (expectedKind) {
      const syntaxKind = SyntaxKind[expectedKind as keyof typeof SyntaxKind];
      if (syntaxKind === undefined || node.getKind() !== syntaxKind) {
        return false;
      }
    }

    // Match $text (regex pattern)
    if (query.$text) {
      const regex = new RegExp(query.$text);
      if (!regex.test(node.getText())) {
        return false;
      }
    }

    // Match nested properties
    for (const [key, value] of Object.entries(query)) {
      if (key === "kind" || key === "$capture" || key === "$text" || key === "$any") {
        continue;
      }

      if (typeof value === "object" && value !== null) {
        const childNode = this.getChildProperty({ node, propertyName: key });
        if (!childNode) {
          return false;
        }
        if (!this.matchNode({ node: childNode, query: value as AstQueryBase, captures, sourceFile })) {
          return false;
        }
      }
    }

    // Capture if requested
    this.captureIfNeeded({ node, query, captures, sourceFile });

    return true;
  }

  private captureIfNeeded(params: {
    node: Node;
    query: AstQueryBase;
    captures: Record<string, CapturedNode>;
    sourceFile: SourceFile;
  }): void {
    const { node, query, captures, sourceFile } = params;
    if (query.$capture) {
      const pos = sourceFile.getLineAndColumnAtPos(node.getStart());
      captures[query.$capture] = {
        text: node.getText(),
        line: pos.line,
        column: pos.column,
        node,
      };
    }
  }

  private getChildProperty(params: { node: Node; propertyName: string }): Node | undefined {
    const { node, propertyName } = params;

    switch (propertyName) {
      case "expression": {
        if (Node.isCallExpression(node)) return node.getExpression();
        if (Node.isPropertyAccessExpression(node)) return node.getExpression();
        if (Node.isAwaitExpression(node)) return node.getExpression();
        if (Node.isAsExpression(node)) return node.getExpression();
        if (Node.isNonNullExpression(node)) return node.getExpression();
        if (Node.isParenthesizedExpression(node)) return node.getExpression();
        break;
      }
      case "name": {
        if (Node.isPropertyAccessExpression(node)) return node.getNameNode();
        if (Node.isFunctionDeclaration(node)) return node.getNameNode();
        if (Node.isClassDeclaration(node)) return node.getNameNode();
        if (Node.isMethodDeclaration(node)) return node.getNameNode();
        break;
      }
      case "operatorToken": {
        if (Node.isBinaryExpression(node)) return node.getOperatorToken();
        break;
      }
      case "left": {
        if (Node.isBinaryExpression(node)) return node.getLeft();
        break;
      }
      case "right": {
        if (Node.isBinaryExpression(node)) return node.getRight();
        break;
      }
      case "condition": {
        if (Node.isConditionalExpression(node)) return node.getCondition();
        break;
      }
      case "whenTrue": {
        if (Node.isConditionalExpression(node)) return node.getWhenTrue();
        break;
      }
      case "whenFalse": {
        if (Node.isConditionalExpression(node)) return node.getWhenFalse();
        break;
      }
      case "arguments": {
        if (Node.isCallExpression(node)) {
          const args = node.getArguments();
          return args[0];
        }
        break;
      }
      case "typeArguments": {
        if (Node.isCallExpression(node)) {
          const typeArgs = node.getTypeArguments();
          return typeArgs[0];
        }
        break;
      }
    }

    return undefined;
  }

  private async findFiles(params: {
    searchPath: string;
    include: string[];
    exclude: string[];
  }): Promise<string[]> {
    const { searchPath, include, exclude } = params;
    const absolutePath = resolve(searchPath);

    if (absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx")) {
      return [absolutePath];
    }

    const patterns = include.map((p) => `${absolutePath}/${p}`);
    const files = await glob(patterns, {
      ignore: exclude.map((p) => `${absolutePath}/${p}`),
      nodir: true,
      absolute: true,
    });

    return files;
  }
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const QUERY_PRESETS: Record<string, AstQuery> = {
  instanceof: {
    kind: "BinaryExpression",
    operatorToken: { kind: "InstanceOfKeyword" },
  },
  console_log: {
    kind: "CallExpression",
    expression: {
      kind: "PropertyAccessExpression",
      expression: { $text: "^console$" },
      name: { $text: "^log$" },
    },
  },
  await_then: {
    kind: "AwaitExpression",
    expression: {
      kind: "CallExpression",
      expression: {
        kind: "PropertyAccessExpression",
        name: { $text: "^then$" },
      },
    },
  },
  non_null_assertion: {
    kind: "NonNullExpression",
  },
  type_assertion: {
    kind: "AsExpression",
  },
  any_type: {
    kind: "AnyKeyword",
  },
  // Common transformation target: error instanceof Error ? error.message : String(error)
  instanceof_error_ternary: {
    kind: "ConditionalExpression",
    condition: {
      kind: "BinaryExpression",
      left: { $any: true, $capture: "errorVar" },
      operatorToken: { kind: "InstanceOfKeyword" },
      right: { kind: "Identifier", $text: "^Error$" },
    },
    whenTrue: {
      kind: "PropertyAccessExpression",
      expression: { $any: true },
      name: { $text: "^message$" },
    },
  },
};
