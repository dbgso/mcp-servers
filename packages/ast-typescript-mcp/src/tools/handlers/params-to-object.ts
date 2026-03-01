import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { Project, Node } from "ts-morph";
import type {
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  ParameterDeclaration,
} from "ts-morph";
import { getHandler } from "../../handlers/index.js";

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
}

interface TransformResult {
  definition: {
    file: string;
    line: number;
    before: string;
    after: string;
  };
  callSites: Array<{
    file: string;
    line: number;
    before: string;
    after: string;
  }>;
  skipped: Array<{
    file: string;
    line: number;
    reason: string;
  }>;
}

export class ParamsToObjectHandler extends BaseToolHandler<ParamsToObjectArgs> {
  readonly name = "params_to_object";
  readonly description = `Transform function parameters to object destructuring pattern.

## What it does
1. Transforms function signature: \`(a: T, b: U)\` → \`({ a, b }: { a: T; b: U })\`
2. Finds all call sites automatically
3. Transforms call sites: \`fn(x, y)\` → \`fn({ a: x, b: y })\`

## Features
- Auto-extracts parameter types from definition
- Handles optional parameters (partial call sites supported)
- Uses shorthand when argument name matches parameter name
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
      // Create project and load source file
      const project = new Project();
      const sourceFile = project.addSourceFileAtPath(file_path);

      // Find the function
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

      // Find all references using the TypeScript handler
      const handler = getHandler(file_path);
      if (!handler) {
        return errorResponse("No handler for file type");
      }

      const refsResult = await handler.findReferences({
        filePath: file_path,
        line,
        column,
      });

      // Filter to call sites only (exclude definition and imports)
      const callSiteRefs = refsResult.references.filter(
        ref => ref.context === "call" || ref.context?.includes("(")
      );

      // Prepare the transformation result
      const result: TransformResult = {
        definition: {
          file: file_path,
          line,
          before: "",
          after: "",
        },
        callSites: [],
        skipped: [],
      };

      // Build param names array for call site transformation
      const paramNames = params.map(p => p.name);

      // Transform the definition
      const defTransform = this.transformDefinition(func, params, dry_run);
      result.definition.before = defTransform.before;
      result.definition.after = defTransform.after;

      // Transform each call site
      for (const ref of callSiteRefs) {
        // Skip the definition itself
        if (ref.filePath === file_path && ref.line === line) {
          continue;
        }

        const callResult = this.transformCallSite({
          project,
          filePath: ref.filePath,
          line: ref.line,
          column: ref.column,
          paramNames,
          dryRun: dry_run,
        });

        if (callResult.skipped) {
          result.skipped.push({
            file: ref.filePath,
            line: ref.line,
            reason: callResult.reason ?? "unknown",
          });
        } else if (callResult.success) {
          result.callSites.push({
            file: ref.filePath,
            line: ref.line,
            before: callResult.before!,
            after: callResult.after!,
          });
        } else {
          result.skipped.push({
            file: ref.filePath,
            line: ref.line,
            reason: callResult.error ?? "transformation failed",
          });
        }
      }

      // Save all modified files if not dry run
      if (!dry_run) {
        await sourceFile.save();
        for (const [, sf] of project.getSourceFiles().entries()) {
          if (sf.getFilePath() !== file_path) {
            await sf.save();
          }
        }
      }

      return jsonResponse({
        functionName,
        params: params.map(p => ({ name: p.name, type: p.type, optional: p.optional })),
        dryRun: dry_run,
        ...result,
        summary: {
          definitionTransformed: true,
          callSitesTransformed: result.callSites.length,
          callSitesSkipped: result.skipped.length,
        },
      });
    } catch (error) {
      return errorResponse(`params_to_object failed: ${getErrorMessage(error)}`);
    }
  }

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

  private extractParamInfo(func: FunctionLike): ParamInfo[] {
    const params: ParameterDeclaration[] = func.getParameters();
    return params.map(p => ({
      name: p.getName(),
      type: p.getType().getText(p),
      optional: p.isOptional() || p.hasInitializer(),
    }));
  }

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

  private transformDefinition(
    func: FunctionLike,
    params: ParamInfo[],
    dryRun: boolean
  ): { before: string; after: string } {
    const funcParams = func.getParameters();
    const oldSignature = funcParams.map(p => p.getText()).join(", ");

    // Build the new signature
    const destructure = params.map(p => p.name).join(", ");
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

  private transformCallSite(params: {
    project: Project;
    filePath: string;
    line: number;
    column: number;
    paramNames: string[];
    dryRun: boolean;
  }): {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    before?: string;
    after?: string;
    error?: string;
  } {
    const { project, filePath, line, column, paramNames, dryRun } = params;

    // Get or add the source file
    let sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      try {
        sourceFile = project.addSourceFileAtPath(filePath);
      } catch {
        return { success: false, error: `Cannot load file: ${filePath}` };
      }
    }

    // Find the call expression
    const position = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
    const nodeAtPosition = sourceFile.getDescendantAtPos(position);
    if (!nodeAtPosition) {
      return { success: false, error: "No node at position" };
    }

    let current: Node | undefined = nodeAtPosition;
    let callExpr: Node | undefined;
    while (current) {
      if (Node.isCallExpression(current)) {
        callExpr = current;
        break;
      }
      current = current.getParent();
    }

    if (!callExpr || !Node.isCallExpression(callExpr)) {
      return { success: false, skipped: true, reason: "Not a call expression" };
    }

    const callArgs = callExpr.getArguments();

    // Check if already transformed (single object literal argument)
    if (callArgs.length === 1 && Node.isObjectLiteralExpression(callArgs[0])) {
      return { success: false, skipped: true, reason: "Already using object argument" };
    }

    // Allow partial matching for optional parameters
    if (callArgs.length > paramNames.length) {
      return {
        success: false,
        skipped: true,
        reason: `Too many arguments: ${callArgs.length} > ${paramNames.length}`,
      };
    }

    if (callArgs.length === 0) {
      return { success: false, skipped: true, reason: "No arguments to transform" };
    }

    // Build the new object argument
    const argTexts = callArgs.map(a => a.getText());
    const functionName = callExpr.getExpression().getText();

    // Use shorthand when argument matches parameter name
    const objectProps = paramNames.slice(0, callArgs.length).map((name, i) => {
      const argText = argTexts[i];
      if (argText === name) {
        return name;
      }
      return `${name}: ${argText}`;
    });

    const newArg = `{ ${objectProps.join(", ")} }`;
    const oldCall = `${functionName}(${argTexts.join(", ")})`;
    const newCall = `${functionName}(${newArg})`;

    if (!dryRun) {
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
