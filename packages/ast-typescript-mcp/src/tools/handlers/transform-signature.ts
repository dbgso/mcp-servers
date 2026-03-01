import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse, BatchContext, BatchChange } from "../types.js";
import { Project, Node } from "ts-morph";
import { acquireFileLock, releaseFileLock } from "../../utils/file-lock.js";
import type {
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  MethodSignature,
  CallSignatureDeclaration,
  ConstructSignatureDeclaration,
  FunctionTypeNode,
  ParameterDeclaration,
  SourceFile,
} from "ts-morph";

const TransformSignatureSchema = z.object({
  file_path: z.string().describe("File containing the function"),
  line: z.number().describe("Line number of the function (1-based)"),
  column: z.number().describe("Column number (1-based)"),
  new_params: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        optional: z.boolean().optional().default(false),
      })
    )
    .describe("New parameter definitions as object properties"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview without modifying (default: true)"),
});

type TransformSignatureArgs = z.infer<typeof TransformSignatureSchema>;

type FunctionLike = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | MethodSignature | CallSignatureDeclaration | ConstructSignatureDeclaration | FunctionTypeNode;

export interface SignatureTransformParams {
  name: string;
  type: string;
  optional?: boolean;
}

export interface SignatureTransformResult {
  functionName: string;
  before: string;
  after: string;
}

/**
 * Collected node information for two-phase batch execution.
 * Captured before any modifications to preserve valid line numbers.
 */
export interface SignatureNodeInfo {
  node: FunctionLike;
  sourceFile: SourceFile;
  functionName: string;
}

/**
 * Prepared transformation with text positions.
 * Can be applied without node references.
 */
export interface SignaturePreparedTransform {
  start: number;
  end: number;
  newText: string;
  functionName: string;
  before: string;
  after: string;
}

export class TransformSignatureHandler extends BaseToolHandler<TransformSignatureArgs> {
  readonly name = "transform_signature";
  readonly description = `Transform function signature to object destructuring.

## What it does
\`(a: T, b: U)\` → \`({ a, b }: { a: T; b: U })\`

## Complete Refactoring Workflow
To refactor a function AND all its call sites:

\`\`\`
1. Get current params:
   ts_ast(action: "read", file_path: "src/foo.ts", line: 10, column: 17)

2. Find call sites:
   ts_ast(action: "references", file_path: "src/foo.ts", line: 10, column: 17)

3. Batch transform all:
   ts_ast(action: "batch", operations: [
     { action: "transform_signature", file_path: "src/foo.ts", line: 10, column: 17,
       new_params: [{ name: "a", type: "string" }, { name: "b", type: "number" }] },
     { action: "transform_call_site", file_path: "src/bar.ts", line: 5, column: 3,
       param_names: ["a", "b"] },
     // ... more call sites
   ])
\`\`\`

## Standalone Usage
\`\`\`json
ts_ast(action: "transform_signature", file_path: "src/foo.ts", line: 10, column: 17,
  new_params: [{ name: "a", type: "string" }, { name: "b", type: "number", optional: true }],
  dry_run: false)
\`\`\``;
  readonly schema = TransformSignatureSchema;

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
      new_params: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            optional: { type: "boolean" },
          },
          required: ["name", "type"],
        },
        description: "New parameter definitions as object properties",
      },
      dry_run: {
        type: "boolean",
        description: "Preview without modifying (default: true)",
      },
    },
    required: ["file_path", "line", "column", "new_params"],
  };

  protected async doExecute(args: TransformSignatureArgs): Promise<ToolResponse> {
    const { file_path, line, column, new_params, dry_run } = args;

    // Acquire file lock to prevent parallel modifications
    if (!dry_run) {
      const lockResult = acquireFileLock({
        filePath: file_path,
        toolName: this.name,
        line,
      });
      if (!lockResult.success) {
        return errorResponse(lockResult.error ?? "Failed to acquire file lock");
      }
    }

    try {
      // Standalone execution: create own project and save immediately
      const project = new Project();
      const sourceFile = project.addSourceFileAtPath(file_path);

      const result = await this.transformSignatureCore({
        sourceFile,
        line,
        column,
        newParams: new_params,
        dryRun: dry_run,
      });

      if (!result.success) {
        return errorResponse(result.error ?? "Unknown error");
      }

      // Save if not dry run (standalone mode)
      if (!dry_run && result.modified) {
        await sourceFile.save();
      }

      return jsonResponse({
        filePath: file_path,
        line,
        functionName: result.functionName,
        before: result.before,
        after: result.after,
        dryRun: dry_run,
        modified: result.modified,
      });
    } catch (error) {
      return errorResponse(
        `transform_signature failed: ${getErrorMessage(error)}`
      );
    } finally {
      // Release file lock
      if (!dry_run) {
        releaseFileLock({ filePath: file_path });
      }
    }
  }

  /**
   * Execute transformation with a shared BatchContext.
   * Used by batch_execute for atomic multi-file transformations.
   */
  async executeWithContext(
    args: Omit<TransformSignatureArgs, "dry_run">,
    context: BatchContext
  ): Promise<{ success: boolean; change?: BatchChange; error?: string }> {
    const { file_path, line, column, new_params } = args;

    // Get or add source file from context
    let sourceFile = context.modifiedFiles.get(file_path);
    if (!sourceFile) {
      sourceFile = context.project.addSourceFileAtPath(file_path);
      context.modifiedFiles.set(file_path, sourceFile);
    }

    const result = await this.transformSignatureCore({
      sourceFile,
      line,
      column,
      newParams: new_params,
      dryRun: context.dryRun,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const change: BatchChange = {
      filePath: file_path,
      line,
      description: `transform_signature: ${result.functionName}`,
      before: result.before ?? "",
      after: result.after ?? "",
    };

    context.changes.push(change);
    return { success: true, change };
  }

  /**
   * Core transformation logic shared by standalone and batch execution.
   */
  private async transformSignatureCore(params: {
    sourceFile: SourceFile;
    line: number;
    column: number;
    newParams: Array<{ name: string; type: string; optional?: boolean }>;
    dryRun: boolean;
  }): Promise<{
    success: boolean;
    functionName?: string;
    before?: string;
    after?: string;
    modified?: boolean;
    error?: string;
  }> {
    const { sourceFile, line, column, newParams, dryRun } = params;

    const func = this.findFunctionAtPosition(sourceFile, line, column);
    if (!func) {
      return { success: false, error: `No function found at line ${line}:${column}` };
    }

    const funcParams: ParameterDeclaration[] = func.getParameters();
    if (funcParams.length === 0) {
      return { success: false, error: "Function has no parameters to transform" };
    }

    // Capture all info BEFORE modifying (nodes become invalid after replaceText)
    const functionName = this.getFunctionName(func);
    const oldSignature = funcParams.map((p: ParameterDeclaration) => p.getText()).join(", ");
    const paramsStart = funcParams[0].getStart();
    const paramsEnd = funcParams[funcParams.length - 1].getEnd();

    // Build the new signature
    const destructure = newParams.map(p => p.name).join(", ");
    const typeProps = newParams
      .map(p => {
        const optional = p.optional ? "?" : "";
        return `${p.name}${optional}: ${p.type}`;
      })
      .join("; ");

    const newSignature = `{ ${destructure} }: { ${typeProps} }`;

    let modified = false;
    if (!dryRun) {
      // Apply the transformation (invalidates func node)
      sourceFile.replaceText([paramsStart, paramsEnd], newSignature);
      modified = true;
    }

    return {
      success: true,
      functionName,
      before: `(${oldSignature})`,
      after: `(${newSignature})`,
      modified,
    };
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
        Node.isFunctionExpression(current) ||
        Node.isMethodSignature(current) ||
        Node.isCallSignatureDeclaration(current) ||
        Node.isConstructSignatureDeclaration(current) ||
        Node.isFunctionTypeNode(current)
      ) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  private getFunctionName(func: FunctionLike): string {
    if (Node.isCallSignatureDeclaration(func)) {
      return "call";
    }
    if (Node.isConstructSignatureDeclaration(func)) {
      return "new";
    }
    if (Node.isFunctionDeclaration(func) || Node.isMethodDeclaration(func) || Node.isMethodSignature(func)) {
      return func.getName() || "anonymous";
    }
    if (Node.isFunctionTypeNode(func)) {
      const parent = func.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (Node.isTypeAliasDeclaration(parent)) {
        return parent.getName();
      }
      return "anonymous";
    }
    const parent = func.getParent();
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    return "anonymous";
  }

  /**
   * Phase 1: Collect node information before any modifications.
   * Call this for all operations BEFORE applying any transformations.
   */
  collectNodeInfo(
    sourceFile: SourceFile,
    line: number,
    column: number
  ): SignatureNodeInfo | { error: string } {
    const node = this.findFunctionAtPosition(sourceFile, line, column);
    if (!node) {
      return { error: `No function found at line ${line}:${column}` };
    }

    const funcParams = node.getParameters();
    if (funcParams.length === 0) {
      return { error: "Function has no parameters to transform" };
    }

    return {
      node,
      sourceFile,
      functionName: this.getFunctionName(node),
    };
  }

  /**
   * Phase 1 (position-based): Prepare transformation with text positions.
   * Returns positions and replacement text that can be applied without node references.
   */
  prepareTransform(
    sourceFile: SourceFile,
    line: number,
    column: number,
    newParams: Array<{ name: string; type: string; optional?: boolean }>
  ): SignaturePreparedTransform | { error: string } {
    const func = this.findFunctionAtPosition(sourceFile, line, column);
    if (!func) {
      return { error: `No function found at line ${line}:${column}` };
    }

    const funcParams: ParameterDeclaration[] = func.getParameters();
    if (funcParams.length === 0) {
      return { error: "Function has no parameters to transform" };
    }

    const functionName = this.getFunctionName(func);
    const oldSignature = funcParams.map((p: ParameterDeclaration) => p.getText()).join(", ");
    const paramsStart = funcParams[0].getStart();
    const paramsEnd = funcParams[funcParams.length - 1].getEnd();

    // Build the new signature
    const destructure = newParams.map((p) => p.name).join(", ");
    const typeProps = newParams
      .map((p) => {
        const optional = p.optional ? "?" : "";
        return `${p.name}${optional}: ${p.type}`;
      })
      .join("; ");

    const newSignature = `{ ${destructure} }: { ${typeProps} }`;

    return {
      start: paramsStart,
      end: paramsEnd,
      newText: newSignature,
      functionName,
      before: `(${oldSignature})`,
      after: `(${newSignature})`,
    };
  }

  /**
   * Phase 2: Apply transformation to a pre-collected node.
   * The node reference remains valid even after other transformations.
   */
  applyToNode(
    nodeInfo: SignatureNodeInfo,
    newParams: Array<{ name: string; type: string; optional?: boolean }>,
    dryRun: boolean
  ): {
    success: boolean;
    before?: string;
    after?: string;
    modified?: boolean;
    error?: string;
  } {
    const { node, sourceFile } = nodeInfo;

    // Validate node is still accessible
    try {
      node.getParameters();
    } catch {
      return { success: false, error: "Node reference is no longer valid" };
    }

    const funcParams: ParameterDeclaration[] = node.getParameters();
    const oldSignature = funcParams.map((p: ParameterDeclaration) => p.getText()).join(", ");
    const paramsStart = funcParams[0].getStart();
    const paramsEnd = funcParams[funcParams.length - 1].getEnd();

    // Build the new signature
    const destructure = newParams.map((p) => p.name).join(", ");
    const typeProps = newParams
      .map((p) => {
        const optional = p.optional ? "?" : "";
        return `${p.name}${optional}: ${p.type}`;
      })
      .join("; ");

    const newSignature = `{ ${destructure} }: { ${typeProps} }`;

    let modified = false;
    if (!dryRun) {
      sourceFile.replaceText([paramsStart, paramsEnd], newSignature);
      modified = true;
    }

    return {
      success: true,
      before: `(${oldSignature})`,
      after: `(${newSignature})`,
      modified,
    };
  }
}
