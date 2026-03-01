import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { Project, Node, SyntaxKind } from "ts-morph";
import type {
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  ParameterDeclaration,
  CallExpression,
  Identifier,
} from "ts-morph";
import { dirname, join } from "path";
import { existsSync } from "fs";

const ParamsToObjectSchema = z.object({
  file_path: z.string().describe("File containing the function"),
  line: z.number().describe("Line number of the function (1-based)"),
  column: z.number().describe("Column number (1-based)"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview without modifying (default: true)"),
});

type ParamsToObjectArgs = z.infer<typeof ParamsToObjectSchema>;

type FunctionLike = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression;

interface ParamInfo {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

interface CallSiteResult {
  file: string;
  line: number;
  before: string;
  after: string;
}

interface SkippedResult {
  file: string;
  line: number;
  reason: string;
}

export class ParamsToObjectHandler extends BaseToolHandler<ParamsToObjectArgs> {
  readonly name = "params_to_object";
  readonly description = `Transform function parameters to object destructuring pattern.

## What it does
1. Transforms function signature: \`(a: T, b: U)\` → \`({ a, b }: { a: T; b: U })\`
2. Finds all call sites automatically (cross-file)
3. Transforms call sites: \`fn(x, y)\` → \`fn({ a: x, b: y })\`

## Features
- Auto-extracts parameter types from definition
- Handles optional parameters (partial call sites supported)
- Uses shorthand when argument name matches parameter name
- Cross-file reference detection via ts-morph
- Preview with dry_run: true (default)

## Example
\`\`\`json
ts_ast(action: "params_to_object", file_path: "src/foo.ts", line: 10, column: 17, dry_run: false)
\`\`\`
`;
  readonly schema = ParamsToObjectSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "File containing the function",
      },
      line: {
        type: "number",
        description: "Line number of the function (1-based)",
      },
      column: {
        type: "number",
        description: "Column number (1-based)",
      },
      dry_run: {
        type: "boolean",
        description: "Preview without modifying (default: true)",
      },
    },
    required: ["file_path", "line", "column"],
  };

  protected async doExecute(args: ParamsToObjectArgs): Promise<ToolResponse> {
    const { file_path, line, column, dry_run } = args;

    try {
      // Create project - try to find tsconfig for cross-file support
      const project = this.createProject(file_path);
      const sourceFile = project.getSourceFile(file_path)
        || project.addSourceFileAtPath(file_path);

      // Find the function at position
      const func = this.findFunctionAtPosition(sourceFile, line, column);
      if (!func) {
        return errorResponse(`No function found at line ${line}:${column}`);
      }

      // Extract parameter info
      const params = this.extractParamInfo(func);
      if (params.length === 0) {
        return errorResponse("Function has no parameters to transform");
      }

      const functionName = this.getFunctionName(func);
      const paramNames = params.map(p => p.name);

      // Find all references using ts-morph's semantic analysis
      const refs = this.findDirectCallSites(func);

      // Transform definition
      const defTransform = this.transformDefinition(func, params, dry_run);

      // Transform call sites
      const callSites: CallSiteResult[] = [];
      const skipped: SkippedResult[] = [];

      for (const { callExpr, refNode } of refs) {
        const result = this.transformCallExpression(callExpr, refNode, paramNames, dry_run);
        if (result.success) {
          callSites.push({
            file: callExpr.getSourceFile().getFilePath(),
            line: callExpr.getStartLineNumber(),
            before: result.before!,
            after: result.after!,
          });
        } else {
          skipped.push({
            file: callExpr.getSourceFile().getFilePath(),
            line: callExpr.getStartLineNumber(),
            reason: result.reason!,
          });
        }
      }

      // Save all modified files if not dry run
      if (!dry_run) {
        await project.save();
      }

      return jsonResponse({
        functionName,
        params: params.map(p => ({ name: p.name, type: p.type, optional: p.optional })),
        dryRun: dry_run,
        definition: {
          file: file_path,
          line: func.getStartLineNumber(),
          before: defTransform.before,
          after: defTransform.after,
        },
        callSites,
        skipped,
        summary: {
          definitionTransformed: true,
          callSitesTransformed: callSites.length,
          callSitesSkipped: skipped.length,
        },
      });
    } catch (error) {
      return errorResponse(`params_to_object failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Create a ts-morph Project with tsconfig if available
   */
  private createProject(filePath: string): Project {
    // Try to find tsconfig.json in parent directories
    let dir = dirname(filePath);
    for (let i = 0; i < 10; i++) {
      const tsconfigPath = join(dir, "tsconfig.json");
      if (existsSync(tsconfigPath)) {
        return new Project({
          tsConfigFilePath: tsconfigPath,
          skipAddingFilesFromTsConfig: false,
        });
      }
      const parentDir = dirname(dir);
      if (parentDir === dir) break;
      dir = parentDir;
    }

    // Fallback: create project without tsconfig
    // Add source files from same directory and common patterns
    const project = new Project();
    project.addSourceFileAtPath(filePath);

    // Try to add related files (same directory)
    const fileDir = dirname(filePath);
    try {
      project.addSourceFilesAtPaths([
        join(fileDir, "*.ts"),
        join(fileDir, "*.tsx"),
        join(fileDir, "**/*.ts"),
        join(fileDir, "**/*.tsx"),
      ]);
    } catch {
      // Ignore glob errors
    }

    return project;
  }

  /**
   * Find the function at the given position
   */
  private findFunctionAtPosition(
    sourceFile: SourceFile,
    line: number,
    column: number
  ): FunctionLike | undefined {
    const position = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
    const nodeAtPosition = sourceFile.getDescendantAtPos(position);
    if (!nodeAtPosition) return undefined;

    let current: Node | undefined = nodeAtPosition;
    while (current) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current)
      ) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  /**
   * Find all direct call sites using findReferencesAsNodes()
   * This is semantic analysis, not text-based search
   */
  private findDirectCallSites(func: FunctionLike): Array<{ callExpr: CallExpression; refNode: Identifier }> {
    const results: Array<{ callExpr: CallExpression; refNode: Identifier }> = [];

    // Get the name node for findReferencesAsNodes
    let nameNode: Node | undefined;
    if (Node.isFunctionDeclaration(func) || Node.isMethodDeclaration(func)) {
      nameNode = func.getNameNode();
    } else {
      // Arrow function or function expression - check if assigned to variable
      const parent = func.getParent();
      if (Node.isVariableDeclaration(parent)) {
        nameNode = parent.getNameNode();
      }
    }

    if (!nameNode) {
      return results;
    }

    // Get all references semantically
    const refs = nameNode.findReferencesAsNodes();

    for (const ref of refs) {
      // Skip non-identifier nodes
      if (!Node.isIdentifier(ref)) continue;

      const parent = ref.getParent();

      // Check if this is a direct call: parent is CallExpression and ref is the expression being called
      if (parent?.isKind(SyntaxKind.CallExpression)) {
        const callExpr = parent as CallExpression;
        const callee = callExpr.getExpression();

        // Verify ref is the callee, not an argument
        // For simple calls: foo() -> callee === ref
        // For property access: obj.foo() -> callee is PropertyAccessExpression, name === ref
        if (callee === ref) {
          results.push({ callExpr, refNode: ref });
        } else if (Node.isPropertyAccessExpression(callee) && callee.getNameNode() === ref) {
          results.push({ callExpr, refNode: ref });
        }
      }
    }

    return results;
  }

  /**
   * Extract parameter information from function
   */
  private extractParamInfo(func: FunctionLike): ParamInfo[] {
    const params: ParameterDeclaration[] = func.getParameters();
    return params.map(p => {
      // Use type node text to preserve original type (e.g., `string | null`)
      const typeNode = p.getTypeNode();
      const typeText = typeNode ? typeNode.getText() : p.getType().getText(p);
      // Extract default value if present
      const initializer = p.getInitializer();
      const defaultValue = initializer ? initializer.getText() : undefined;
      return {
        name: p.getName(),
        type: typeText,
        optional: p.isOptional() || p.hasInitializer(),
        defaultValue,
      };
    });
  }

  /**
   * Get function name for display
   */
  private getFunctionName(func: FunctionLike): string {
    if (Node.isFunctionDeclaration(func) || Node.isMethodDeclaration(func)) {
      return func.getName() || "anonymous";
    }
    const parent = func.getParent();
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    return "anonymous";
  }

  /**
   * Transform function definition to use object destructuring
   */
  private transformDefinition(
    func: FunctionLike,
    params: ParamInfo[],
    dryRun: boolean
  ): { before: string; after: string } {
    const funcParams = func.getParameters();
    const oldSignature = funcParams.map(p => p.getText()).join(", ");

    // Build the new signature with default values preserved
    const destructure = params
      .map(p => (p.defaultValue ? `${p.name} = ${p.defaultValue}` : p.name))
      .join(", ");
    const typeProps = params
      .map(p => {
        const optional = p.optional ? "?" : "";
        return `${p.name}${optional}: ${p.type}`;
      })
      .join("; ");

    const newSignature = `{ ${destructure} }: { ${typeProps} }`;

    if (!dryRun) {
      const sourceFile = func.getSourceFile();
      const paramsStart = funcParams[0].getStart();
      const paramsEnd = funcParams[funcParams.length - 1].getEnd();
      sourceFile.replaceText([paramsStart, paramsEnd], newSignature);
    }

    return {
      before: `(${oldSignature})`,
      after: `(${newSignature})`,
    };
  }

  /**
   * Transform a call expression to use object argument
   */
  private transformCallExpression(
    callExpr: CallExpression,
    _refNode: Identifier,
    paramNames: string[],
    dryRun: boolean
  ): { success: boolean; before?: string; after?: string; reason?: string } {
    const callArgs = callExpr.getArguments();

    // Check if already transformed (single object literal argument)
    if (callArgs.length === 1 && Node.isObjectLiteralExpression(callArgs[0])) {
      return { success: false, reason: "Already using object argument" };
    }

    // Allow partial matching for optional parameters
    if (callArgs.length > paramNames.length) {
      return {
        success: false,
        reason: `Too many arguments: ${callArgs.length} > ${paramNames.length}`,
      };
    }

    if (callArgs.length === 0) {
      return { success: false, reason: "No arguments to transform" };
    }

    // Build the new object argument
    const argTexts = callArgs.map(a => a.getText());
    const calleeName = callExpr.getExpression().getText();

    // Use shorthand when argument matches parameter name
    const objectProps = paramNames.slice(0, callArgs.length).map((name, i) => {
      const argText = argTexts[i];
      if (argText === name) {
        return name; // shorthand
      }
      return `${name}: ${argText}`;
    });

    const newArg = `{ ${objectProps.join(", ")} }`;
    const oldCall = `${calleeName}(${argTexts.join(", ")})`;
    const newCall = `${calleeName}(${newArg})`;

    if (!dryRun) {
      const sourceFile = callExpr.getSourceFile();
      const argsStart = callArgs[0].getStart();
      const argsEnd = callArgs[callArgs.length - 1].getEnd();
      sourceFile.replaceText([argsStart, argsEnd], newArg);
    }

    return {
      success: true,
      before: oldCall,
      after: newCall,
    };
  }
}
