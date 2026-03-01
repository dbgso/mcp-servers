import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { Project, Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import { glob } from "glob";
import { resolve } from "node:path";

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESETS: Record<string, AstQuery> = {
  // instanceof checks - polymorphism violations
  instanceof: {
    kind: "BinaryExpression",
    operatorToken: { kind: "InstanceOfKeyword" },
  },

  // console.log calls
  console_log: {
    kind: "CallExpression",
    expression: {
      kind: "PropertyAccessExpression",
      expression: { $text: "^console$" },
      name: { $text: "^log$" },
    },
  },

  // await x.then() anti-pattern
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

  // Non-null assertion (x!)
  non_null_assertion: {
    kind: "NonNullExpression",
  },

  // Type assertion (x as Type)
  type_assertion: {
    kind: "AsExpression",
  },

  // any type usage (the 'any' keyword in type positions)
  any_type: {
    kind: "AnyKeyword",
  },

  // debugger statements - should be removed before commit
  debugger: {
    kind: "DebuggerStatement",
  },

  // throw string literal - should throw Error instead
  throw_string: {
    kind: "ThrowStatement",
    expression: { kind: "StringLiteral" },
  },

  // eval() calls - security risk
  eval: {
    kind: "CallExpression",
    expression: { $text: "^eval$" },
  },

  // delete operator - often indicates code smell
  delete: {
    kind: "DeleteExpression",
  },

  // .bind(this) - often unnecessary with arrow functions
  bind_this: {
    kind: "CallExpression",
    expression: {
      kind: "PropertyAccessExpression",
      name: { $text: "^bind$" },
    },
  },

  // Empty catch block - error swallowing
  empty_catch: {
    kind: "CatchClause",
    block: { $text: "^\\{\\s*\\}$" },
  },

  // TODO/FIXME comments (JsDoc style)
  todo_comment: {
    kind: "JSDocTag",
    $text: "(TODO|FIXME|XXX|HACK)",
  },

  // Relative imports with ../ (potential alias candidates)
  relative_import: {
    kind: "ImportDeclaration",
    moduleSpecifier: { $text: '"\\.\\.' },
  },

  // Dynamic import() calls
  dynamic_import: {
    kind: "CallExpression",
    expression: { kind: "ImportKeyword" },
  },

  // require() calls (CommonJS in TypeScript)
  require: {
    kind: "CallExpression",
    expression: { $text: "^require$" },
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

// Base query properties (nested queries may omit kind if using $text or $any)
interface AstQueryBase {
  kind?: string;
  $capture?: string;
  $text?: string;
  $any?: true;
  [key: string]: AstQueryBase | string | boolean | undefined;
}

// Root query requires kind
interface AstQuery extends AstQueryBase {
  kind: string;
}

interface QueryMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  kind: string;
  captures?: Record<string, { text: string; line: number; column: number }>;
}

interface QueryAstResult {
  matches: QueryMatch[];
  totalFiles: number;
  filesWithMatches: number;
  preset?: string;
  truncated: boolean;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

// Base schema allows kind to be optional (for nested queries with $any or $text)
const AstQueryBaseSchema: z.ZodType<AstQueryBase> = z.lazy(() =>
  z.object({
    kind: z.string().optional().describe("SyntaxKind name (e.g., 'BinaryExpression', 'CallExpression')"),
    $capture: z.string().optional().describe("Name to capture this node under"),
    $text: z.string().optional().describe("Regex pattern to match node text"),
    $any: z.literal(true).optional().describe("Match any node"),
  }).catchall(z.union([z.lazy(() => AstQueryBaseSchema), z.string(), z.boolean()]))
);

// Root query schema requires kind
const AstQuerySchema: z.ZodType<AstQuery> = AstQueryBaseSchema.refine(
  (data) => data.kind !== undefined,
  { message: "Root query must have 'kind' property" }
) as z.ZodType<AstQuery>;

const QueryAstSchema = z.object({
  path: z.string().describe("File or directory to search"),
  query: AstQuerySchema.optional().describe("AST query object"),
  preset: z.enum([
    "instanceof",
    "console_log",
    "await_then",
    "non_null_assertion",
    "type_assertion",
    "any_type",
    "debugger",
    "throw_string",
    "eval",
    "delete",
    "bind_this",
    "empty_catch",
    "todo_comment",
    "relative_import",
    "dynamic_import",
    "require",
  ]).optional().describe("Use a preset query instead of custom query"),
  limit: z.number().optional().default(100).describe("Maximum matches to return (default: 100)"),
  output: z.enum(["full", "compact", "summary"]).optional().default("full").describe(
    "Output mode: full (default, max 200 chars), compact (first line only), summary (file+line+kind only)"
  ),
  include: z.array(z.string()).optional().default(["**/*.ts", "**/*.tsx"]).describe("Glob patterns to include"),
  exclude: z.array(z.string()).optional().default(["**/node_modules/**", "**/*.d.ts"]).describe("Glob patterns to exclude"),
}).refine(
  (data) => data.query !== undefined || data.preset !== undefined,
  { message: "Either 'query' or 'preset' must be provided" }
);

type QueryAstArgs = z.infer<typeof QueryAstSchema>;

// ─── Handler ─────────────────────────────────────────────────────────────────

export class QueryAstHandler extends BaseToolHandler<QueryAstArgs> {
  readonly name = "query_ast";
  readonly description = `AST pattern search in TypeScript files.

## Can Do
- Find function calls: \`{ kind: "CallExpression", expression: { $text: "^myFunc$" } }\`
- Find instanceof checks: \`preset: "instanceof"\`
- Find console.log: \`preset: "console_log"\`
- Match by node kind + text pattern
- Capture matched nodes: \`$capture: "name"\`
- Search directory recursively

## Cannot Do
- Filter by argument count (e.g., calls with exactly 2 args)
- Match array indices (e.g., arguments[0])
- Complex boolean logic (AND/OR conditions)

## Output Modes
- **full** (default): up to 200 chars of matched text
- **compact**: first line only (up to 100 chars)
- **summary**: file+line+kind only, no text (smallest output)

## Presets
- **Code smells**: instanceof, non_null_assertion, type_assertion, any_type, delete, bind_this, empty_catch
- **Debug artifacts**: console_log, debugger, todo_comment
- **Anti-patterns**: await_then, throw_string, eval
- **Imports**: relative_import, dynamic_import, require

## Custom Query Example
\`\`\`json
{
  "kind": "CallExpression",
  "expression": {
    "kind": "PropertyAccessExpression",
    "name": { "$text": "^execute$" }
  }
}
\`\`\`
Finds: obj.execute(...), handler.execute(...)`;
  readonly schema = QueryAstSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "File or directory to search",
      },
      query: {
        type: "object",
        description: "AST query object with 'kind' and optional matchers ($text, $capture, $any)",
      },
      preset: {
        type: "string",
        enum: ["instanceof", "console_log", "await_then", "non_null_assertion", "type_assertion", "any_type", "debugger", "throw_string", "eval", "delete", "bind_this", "empty_catch", "todo_comment", "relative_import", "dynamic_import", "require"],
        description: "Use a preset query",
      },
      limit: {
        type: "number",
        description: "Maximum matches to return (default: 100)",
      },
      output: {
        type: "string",
        enum: ["full", "compact", "summary"],
        description: "Output mode: full (default), compact (first line), summary (no text)",
      },
      include: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to include (default: ['**/*.ts', '**/*.tsx'])",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to exclude (default: ['**/node_modules/**', '**/*.d.ts'])",
      },
    },
    required: ["path"],
  };

  protected async doExecute(args: QueryAstArgs): Promise<ToolResponse> {
    const { path: searchPath, query, preset, limit, output, include, exclude } = args;

    try {
      // Resolve query from preset or use provided query
      const effectiveQuery = preset ? PRESETS[preset] : query;
      if (!effectiveQuery) {
        return errorResponse("Either 'query' or 'preset' must be provided");
      }

      // Find files to search
      const files = await this.findFiles({ searchPath, include, exclude });
      if (files.length === 0) {
        return jsonResponse({
          matches: [],
          totalFiles: 0,
          filesWithMatches: 0,
          preset,
          truncated: false,
        });
      }

      // Search each file
      const project = new Project({ skipAddingFilesFromTsConfig: true });
      const allMatches: QueryMatch[] = [];
      let filesWithMatches = 0;
      let truncated = false;

      for (const file of files) {
        // Check if we already hit the limit
        if (allMatches.length >= limit) {
          truncated = true;
          break;
        }

        const sourceFile = project.addSourceFileAtPath(file);
        const remainingLimit = limit - allMatches.length;
        const matches = this.searchFile({ sourceFile, query: effectiveQuery, limit: remainingLimit, output });

        if (matches.length > 0) {
          filesWithMatches++;
          allMatches.push(...matches);
        }

        // Check if we hit the limit during this file search
        if (matches.length >= remainingLimit) {
          truncated = true;
        }

        // Remove source file to free memory
        project.removeSourceFile(sourceFile);
      }

      const result: QueryAstResult = {
        matches: allMatches,
        totalFiles: files.length,
        filesWithMatches,
        preset,
        truncated,
      };

      return jsonResponse(result);
    } catch (error) {
      return errorResponse(
        `query_ast failed: ${getErrorMessage(error)}`
      );
    }
  }

  private async findFiles(params: {
    searchPath: string;
    include: string[];
    exclude: string[];
  }): Promise<string[]> {
    const { searchPath, include, exclude } = params;
    const absolutePath = resolve(searchPath);

    // Check if it's a single file
    if (absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx")) {
      return [absolutePath];
    }

    // Directory search with glob
    const patterns = include.map((p) => `${absolutePath}/${p}`);
    const files = await glob(patterns, {
      ignore: exclude.map((p) => `${absolutePath}/${p}`),
      nodir: true,
      absolute: true,
    });

    return files;
  }

  private searchFile(params: {
    sourceFile: SourceFile;
    query: AstQuery;
    limit: number;
    output: "full" | "compact" | "summary";
  }): QueryMatch[] {
    const { sourceFile, query, limit, output } = params;
    const matches: QueryMatch[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (matches.length >= limit) {
        return false; // Stop traversal
      }

      const captures: Record<string, { text: string; line: number; column: number }> = {};
      if (this.matchNode({ node, query, captures })) {
        const pos = sourceFile.getLineAndColumnAtPos(node.getStart());

        // Format text based on output mode
        let text: string;
        if (output === "summary") {
          text = ""; // No text in summary mode
        } else if (output === "compact") {
          const fullText = node.getText();
          const firstLine = fullText.split("\n")[0];
          text = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine;
        } else {
          // full mode
          const fullText = node.getText();
          text = fullText.length > 200 ? fullText.slice(0, 200) + "..." : fullText;
        }

        const match: QueryMatch = {
          file: filePath,
          line: pos.line,
          column: pos.column,
          text,
          kind: node.getKindName(),
        };

        // Only include captures if not in summary mode and there are captures
        if (output !== "summary" && Object.keys(captures).length > 0) {
          match.captures = captures;
        }

        matches.push(match);
      }

      return undefined; // Continue traversal
    });

    return matches;
  }

  private matchNode(params: {
    node: Node;
    query: AstQueryBase;
    captures: Record<string, { text: string; line: number; column: number }>;
  }): boolean {
    const { node, query, captures } = params;

    // Match $any - matches any node
    if (query.$any === true) {
      this.captureIfNeeded({ node, query, captures });
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
        if (!this.matchNode({ node: childNode, query: value as AstQueryBase, captures })) {
          return false;
        }
      }
    }

    // Capture if requested
    this.captureIfNeeded({ node, query, captures });

    return true;
  }

  private captureIfNeeded(params: {
    node: Node;
    query: AstQueryBase;
    captures: Record<string, { text: string; line: number; column: number }>;
  }): void {
    const { node, query, captures } = params;
    if (query.$capture) {
      const sourceFile = node.getSourceFile();
      const pos = sourceFile.getLineAndColumnAtPos(node.getStart());
      captures[query.$capture] = {
        text: node.getText(),
        line: pos.line,
        column: pos.column,
      };
    }
  }

  private getChildProperty(params: { node: Node; propertyName: string }): Node | undefined {
    const { node, propertyName } = params;

    // Common property mappings
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
      case "arguments": {
        if (Node.isCallExpression(node)) {
          const args = node.getArguments();
          return args[0]; // Return first argument for simplicity
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
      case "moduleSpecifier": {
        if (Node.isImportDeclaration(node)) return node.getModuleSpecifier();
        if (Node.isExportDeclaration(node)) return node.getModuleSpecifier();
        break;
      }
      case "importClause": {
        if (Node.isImportDeclaration(node)) return node.getImportClause();
        break;
      }
      case "namedBindings": {
        if (Node.isImportClause(node)) return node.getNamedBindings();
        break;
      }
      case "condition": {
        if (Node.isConditionalExpression(node)) return node.getCondition();
        if (Node.isIfStatement(node)) return node.getExpression();
        break;
      }
      case "thenStatement": {
        if (Node.isIfStatement(node)) return node.getThenStatement();
        break;
      }
      case "elseStatement": {
        if (Node.isIfStatement(node)) return node.getElseStatement();
        break;
      }
      case "initializer": {
        if (Node.isVariableDeclaration(node)) return node.getInitializer();
        if (Node.isPropertyDeclaration(node)) return node.getInitializer();
        break;
      }
      case "type": {
        if (Node.isVariableDeclaration(node)) return node.getTypeNode();
        if (Node.isParameterDeclaration(node)) return node.getTypeNode();
        if (Node.isFunctionDeclaration(node)) return node.getReturnTypeNode();
        if (Node.isAsExpression(node)) return node.getTypeNode();
        break;
      }
    }

    return undefined;
  }
}
