import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { Project, Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type {
  RemoveTarget,
  RemoveNodeResult,
  TsRemoveNodesResult,
} from "../../types/index.js";

// Schema definitions
const RemoveNamedTargetSchema = z.object({
  type: z.enum(["function", "class", "interface", "type", "enum", "variable"]),
  name: z.string().describe("Exact name of the declaration"),
});

const RemoveCallBlockTargetSchema = z.object({
  type: z.literal("call_block"),
  call_name: z.string().describe("Call expression name (e.g., 'describe', 'it', 'test')"),
  first_arg: z.string().optional().describe("Exact match for first argument string"),
  first_arg_pattern: z.string().optional().describe("Regex pattern for first argument"),
});

const RemoveStatementAtLineTargetSchema = z.object({
  type: z.literal("statement_at_line"),
  line: z.number().describe("Line number (1-based) - use as fallback"),
});

const RemoveTargetSchema = z.discriminatedUnion("type", [
  RemoveNamedTargetSchema,
  RemoveCallBlockTargetSchema,
  RemoveStatementAtLineTargetSchema,
]);

const TsRemoveNodesSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  targets: z.array(RemoveTargetSchema).min(1).describe("Nodes to remove"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview changes without modifying file (default: true)"),
});

type TsRemoveNodesArgs = z.infer<typeof TsRemoveNodesSchema>;

/** Collected node info for two-phase execution */
interface CollectedNode {
  target: RemoveTarget;
  node: Node;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  nodeName: string;
  nodeKind: string;
  sourcePreview: string;
}

export class RemoveNodesHandler extends BaseToolHandler<TsRemoveNodesArgs> {
  readonly name = "ts_remove_nodes";
  readonly description =
    "Remove multiple AST nodes from a TypeScript file. Supports functions, classes, interfaces, " +
    "types, variables, enums, and call blocks (describe/it). Uses name-based targeting to avoid " +
    "line number issues. Default dry_run=true for safety.";
  readonly schema = TsRemoveNodesSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file",
      },
      targets: {
        type: "array",
        items: {
          type: "object",
          oneOf: [
            {
              properties: {
                type: { type: "string", enum: ["function", "class", "interface", "type", "enum", "variable"] },
                name: { type: "string", description: "Exact name of the declaration" },
              },
              required: ["type", "name"],
            },
            {
              properties: {
                type: { type: "string", const: "call_block" },
                call_name: { type: "string", description: "Call expression name (e.g., 'describe', 'it')" },
                first_arg: { type: "string", description: "Exact match for first argument" },
                first_arg_pattern: { type: "string", description: "Regex pattern for first argument" },
              },
              required: ["type", "call_name"],
            },
            {
              properties: {
                type: { type: "string", const: "statement_at_line" },
                line: { type: "number", description: "Line number (1-based)" },
              },
              required: ["type", "line"],
            },
          ],
        },
        description: "Nodes to remove",
      },
      dry_run: {
        type: "boolean",
        description: "Preview changes without modifying file (default: true)",
      },
    },
    required: ["file_path", "targets"],
  };

  protected async doExecute(args: TsRemoveNodesArgs): Promise<ToolResponse> {
    const { file_path, targets, dry_run } = args;

    try {
      const project = new Project({ skipAddingFilesFromTsConfig: true });
      const sourceFile = project.addSourceFileAtPath(file_path);

      // PHASE 1: Collect all target nodes and their positions
      const collectedNodes: CollectedNode[] = [];
      const errors: RemoveNodeResult[] = [];

      for (const target of targets) {
        const nodes = this.findTargetNodes({ sourceFile, target });

        if (nodes.length === 0) {
          errors.push({
            target,
            success: false,
            nodeName: this.getTargetDisplayName(target),
            nodeKind: target.type,
            startLine: 0,
            endLine: 0,
            linesRemoved: 0,
            sourcePreview: "",
            error: `Target not found: ${this.getTargetDisplayName(target)}`,
          });
          continue;
        }

        for (const node of nodes) {
          collectedNodes.push({
            target,
            node,
            start: node.getStart(),
            end: node.getEnd(),
            startLine: node.getStartLineNumber(),
            endLine: node.getEndLineNumber(),
            nodeName: this.getNodeName({ node: node, target: target }),
            nodeKind: this.getNodeKind(node),
            sourcePreview: this.truncateSource({ source: node.getText(), maxLength: 100 }),
          });
        }
      }

      // Deduplicate by position (same node targeted multiple times)
      const uniqueNodes = this.deduplicateByPosition(collectedNodes);

      // Sort by position DESCENDING (remove from bottom first)
      uniqueNodes.sort((a, b) => b.start - a.start);

      // PHASE 2: Apply removals (if not dry_run)
      const results: RemoveNodeResult[] = [...errors];

      for (const collected of uniqueNodes) {
        if (!dry_run) {
          try {
            // Use type assertion - collected nodes are always removable statements/declarations
            (collected.node as unknown as { remove(): void }).remove();
            results.push({
              target: collected.target,
              success: true,
              nodeName: collected.nodeName,
              nodeKind: collected.nodeKind,
              startLine: collected.startLine,
              endLine: collected.endLine,
              linesRemoved: collected.endLine - collected.startLine + 1,
              sourcePreview: collected.sourcePreview,
            });
          } catch (error) {
            results.push({
              target: collected.target,
              success: false,
              nodeName: collected.nodeName,
              nodeKind: collected.nodeKind,
              startLine: collected.startLine,
              endLine: collected.endLine,
              linesRemoved: 0,
              sourcePreview: collected.sourcePreview,
              error: getErrorMessage(error),
            });
          }
        } else {
          // Dry-run: report what would be removed
          results.push({
            target: collected.target,
            success: true,
            nodeName: collected.nodeName,
            nodeKind: collected.nodeKind,
            startLine: collected.startLine,
            endLine: collected.endLine,
            linesRemoved: collected.endLine - collected.startLine + 1,
            sourcePreview: collected.sourcePreview,
          });
        }
      }

      // Save file if not dry_run
      if (!dry_run) {
        await sourceFile.save();
      }

      // Sort results by original line number for readability
      results.sort((a, b) => a.startLine - b.startLine);

      const successResults = results.filter((r) => r.success);
      const totalLinesRemoved = successResults.reduce((sum, r) => sum + r.linesRemoved, 0);

      const response: TsRemoveNodesResult = {
        filePath: file_path,
        dryRun: dry_run,
        results,
        removedCount: successResults.length,
        failedCount: results.filter((r) => !r.success).length,
        totalLinesRemoved,
        summary: this.buildSummary({ results: results, dryRun: dry_run, totalLinesRemoved: totalLinesRemoved }),
      };

      return jsonResponse(response);
    } catch (error) {
      return errorResponse(
        `ts_remove_nodes failed: ${getErrorMessage(error)}`
      );
    }
  }

  private findTargetNodes({ sourceFile, target }: { sourceFile: SourceFile; target: RemoveTarget }): Node[] {
    switch (target.type) {
      case "function": {
        const fn = sourceFile.getFunction(target.name);
        return fn ? [fn] : [];
      }

      case "class": {
        const cls = sourceFile.getClass(target.name);
        return cls ? [cls] : [];
      }

      case "interface": {
        const iface = sourceFile.getInterface(target.name);
        return iface ? [iface] : [];
      }

      case "type": {
        const typeAlias = sourceFile.getTypeAlias(target.name);
        return typeAlias ? [typeAlias] : [];
      }

      case "enum": {
        const enumDecl = sourceFile.getEnum(target.name);
        return enumDecl ? [enumDecl] : [];
      }

      case "variable": {
        for (const varStmt of sourceFile.getVariableStatements()) {
          for (const decl of varStmt.getDeclarations()) {
            if (decl.getName() === target.name) {
              return [varStmt];
            }
          }
        }
        return [];
      }

      case "call_block":
        return this.findCallBlocks({ sourceFile: sourceFile, target: target });

      case "statement_at_line":
        return this.findStatementAtLine({ sourceFile: sourceFile, line: target.line });

      default:
        return [];
    }
  }

  private findCallBlocks(
    { sourceFile, target }: { sourceFile: SourceFile; target: { call_name: string; first_arg?: string; first_arg_pattern?: string } }
  ): Node[] {
    const results: Node[] = [];
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const callee = call.getExpression();

      // Get callee name
      let calleeName: string | null = null;
      if (Node.isIdentifier(callee)) {
        calleeName = callee.getText();
      } else if (Node.isPropertyAccessExpression(callee)) {
        const base = callee.getExpression();
        if (Node.isIdentifier(base)) {
          calleeName = base.getText();
        }
      }

      if (calleeName !== target.call_name) continue;

      const args = call.getArguments();
      const firstArg = args[0];
      if (!firstArg) continue;

      // Extract string value from first argument
      let argValue: string;
      if (Node.isStringLiteral(firstArg)) {
        argValue = firstArg.getLiteralText();
      } else if (
        Node.isTemplateExpression(firstArg) ||
        Node.isNoSubstitutionTemplateLiteral(firstArg)
      ) {
        argValue = firstArg.getText().replace(/^`|`$/g, "");
      } else {
        argValue = firstArg.getText();
      }

      // Match by exact name or pattern
      let matches = false;
      if (target.first_arg && argValue === target.first_arg) {
        matches = true;
      } else if (target.first_arg_pattern && new RegExp(target.first_arg_pattern).test(argValue)) {
        matches = true;
      } else if (!target.first_arg && !target.first_arg_pattern) {
        // No filter specified - match all with this call_name
        matches = true;
      }

      if (matches) {
        // Return the containing statement (ExpressionStatement)
        const stmt = this.getContainingStatement(call);
        if (stmt) {
          results.push(stmt);
        }
      }
    }

    return results;
  }

  private findStatementAtLine({ sourceFile, line }: { sourceFile: SourceFile; line: number }): Node[] {
    const statements = sourceFile.getStatements();

    for (const stmt of statements) {
      if (stmt.getStartLineNumber() === line) {
        return [stmt];
      }
    }

    return [];
  }

  private getContainingStatement(node: Node): Node | null {
    let current: Node | undefined = node;
    while (current) {
      if (Node.isExpressionStatement(current)) {
        return current;
      }
      // Also handle other statement types
      if (Node.isStatement(current) && current.getParent() === current.getSourceFile()) {
        return current;
      }
      current = current.getParent();
    }
    return node;
  }

  private deduplicateByPosition(nodes: CollectedNode[]): CollectedNode[] {
    const seen = new Set<string>();
    const unique: CollectedNode[] = [];

    for (const node of nodes) {
      const key = `${node.start}:${node.end}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(node);
      }
    }

    return unique;
  }

  private getTargetDisplayName(target: RemoveTarget): string {
    switch (target.type) {
      case "call_block":
        if (target.first_arg) return `${target.call_name}("${target.first_arg}")`;
        if (target.first_arg_pattern) return `${target.call_name}(/${target.first_arg_pattern}/)`;
        return target.call_name;
      case "statement_at_line":
        return `statement at line ${target.line}`;
      default:
        return target.name;
    }
  }

  private getNodeName({ node, target }: { node: Node; target: RemoveTarget }): string {
    if (target.type === "call_block") {
      // Extract name from call expression's first argument
      if (Node.isExpressionStatement(node)) {
        const expr = node.getExpression();
        if (Node.isCallExpression(expr)) {
          const args = expr.getArguments();
          if (args[0] && Node.isStringLiteral(args[0])) {
            return args[0].getLiteralText();
          }
        }
      }
    }

    if (
      Node.isFunctionDeclaration(node) ||
      Node.isClassDeclaration(node) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isTypeAliasDeclaration(node) ||
      Node.isEnumDeclaration(node)
    ) {
      return node.getName() ?? "(anonymous)";
    }

    if (Node.isVariableStatement(node)) {
      const decls = node.getDeclarations();
      return decls.map((d) => d.getName()).join(", ");
    }

    return this.getTargetDisplayName(target);
  }

  private getNodeKind(node: Node): string {
    if (Node.isFunctionDeclaration(node)) return "function";
    if (Node.isClassDeclaration(node)) return "class";
    if (Node.isInterfaceDeclaration(node)) return "interface";
    if (Node.isTypeAliasDeclaration(node)) return "type";
    if (Node.isEnumDeclaration(node)) return "enum";
    if (Node.isVariableStatement(node)) return "variable";
    if (Node.isExpressionStatement(node)) return "call_block";
    return "statement";
  }

  private truncateSource({ source, maxLength }: { source: string; maxLength: number }): string {
    const firstLine = source.split("\n")[0];
    if (firstLine.length <= maxLength) {
      return firstLine;
    }
    return firstLine.slice(0, maxLength - 3) + "...";
  }

  private buildSummary(
    { results, dryRun, totalLinesRemoved }: { results: RemoveNodeResult[]; dryRun: boolean; totalLinesRemoved: number }
  ): string {
    const success = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const action = dryRun ? "Would remove" : "Removed";
    let summary = `${action} ${success.length} node(s) (${totalLinesRemoved} lines)`;

    if (failed.length > 0) {
      summary += `, ${failed.length} failed`;
    }

    return summary;
  }
}
