import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse, BatchContext, BatchChange } from "../types.js";
import { Project, Node } from "ts-morph";
import type { SourceFile, CallExpression } from "ts-morph";
import { acquireFileLock, releaseFileLock } from "../../utils/file-lock.js";

const TransformCallSiteSchema = z.object({
  file_path: z.string().describe("File containing the call site"),
  line: z.number().describe("Line number of the call (1-based)"),
  column: z.number().describe("Column number (1-based)"),
  param_names: z
    .array(z.string())
    .describe("Parameter names in order (e.g., ['name', 'age', 'country'])"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview without modifying (default: true)"),
});

type TransformCallSiteArgs = z.infer<typeof TransformCallSiteSchema>;

/**
 * Collected node information for two-phase batch execution.
 * Captured before any modifications to preserve valid line numbers.
 */
export interface CallSiteNodeInfo {
  node: CallExpression;
  sourceFile: SourceFile;
  functionName: string;
}

/**
 * Prepared transformation with text positions.
 * Can be applied without node references.
 */
export interface CallSitePreparedTransform {
  start: number;
  end: number;
  newText: string;
  functionName: string;
  before: string;
  after: string;
}

export class TransformCallSiteHandler extends BaseToolHandler<TransformCallSiteArgs> {
  readonly name = "transform_call_site";
  readonly description = `Transform function call arguments to object pattern.

## Can Do
- \`fn(a, b)\` → \`fn({ x: a, y: b })\`
- Works with any expression as arguments
- Skips already-transformed calls (single object arg)
- Batch via \`ts_ast(action: "batch")\`

## Cannot Do
- Add/remove arguments (count must match param_names)
- Transform spread arguments
- Transform destructuring in args

## Workflow
1. Find call sites: \`ts_ast(action: "references", ...)\`
2. Preview: \`ts_ast(action: "transform_call_site", ..., dry_run: true)\`
3. Apply: \`ts_ast(action: "transform_call_site", ..., dry_run: false)\`

## Batch Transform
\`\`\`json
ts_ast(action: "batch", mode: "execute", operations: [
  { tool: "transform_call_site", args: { file_path: "a.ts", line: 10, column: 5, param_names: ["x", "y"] } },
  { tool: "transform_call_site", args: { file_path: "b.ts", line: 20, column: 3, param_names: ["x", "y"] } }
])
\`\`\``;
  readonly schema = TransformCallSiteSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "File containing the call site",
      },
      line: {
        type: "number",
        description: "Line number of the call (1-based)",
      },
      column: {
        type: "number",
        description: "Column number (1-based)",
      },
      param_names: {
        type: "array",
        items: { type: "string" },
        description: "Parameter names in order (e.g., ['name', 'age', 'country'])",
      },
      dry_run: {
        type: "boolean",
        description: "Preview without modifying (default: true)",
      },
    },
    required: ["file_path", "line", "column", "param_names"],
  };

  protected async doExecute(args: TransformCallSiteArgs): Promise<ToolResponse> {
    const { file_path, line, column, param_names, dry_run } = args;

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

      const result = await this.transformCallSiteCore({
        sourceFile,
        line,
        column,
        paramNames: param_names,
        dryRun: dry_run,
      });

      if (!result.success) {
        if (result.skipped) {
          return jsonResponse({
            filePath: file_path,
            line,
            skipped: true,
            reason: result.skipReason,
            dryRun: dry_run,
            modified: false,
          });
        }
        return errorResponse(result.error ?? "Unknown error");
      }

      // Save if not dry run (standalone mode)
      if (!dry_run && result.modified) {
        await sourceFile.save();
      }

      return jsonResponse({
        filePath: file_path,
        line,
        before: result.before,
        after: result.after,
        dryRun: dry_run,
        modified: result.modified,
      });
    } catch (error) {
      return errorResponse(
        `transform_call_site failed: ${getErrorMessage(error)}`
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
    args: Omit<TransformCallSiteArgs, "dry_run">,
    context: BatchContext
  ): Promise<{ success: boolean; skipped?: boolean; change?: BatchChange; error?: string }> {
    const { file_path, line, column, param_names } = args;

    // Get or add source file from context
    let sourceFile = context.modifiedFiles.get(file_path);
    if (!sourceFile) {
      sourceFile = context.project.addSourceFileAtPath(file_path);
      context.modifiedFiles.set(file_path, sourceFile);
    }

    const result = await this.transformCallSiteCore({
      sourceFile,
      line,
      column,
      paramNames: param_names,
      dryRun: context.dryRun,
    });

    if (!result.success) {
      if (result.skipped) {
        return { success: true, skipped: true };
      }
      return { success: false, error: result.error };
    }

    const change: BatchChange = {
      filePath: file_path,
      line,
      description: `transform_call_site`,
      before: result.before!,
      after: result.after!,
    };

    context.changes.push(change);
    return { success: true, change };
  }

  /**
   * Core transformation logic shared by standalone and batch execution.
   */
  private async transformCallSiteCore(params: {
    sourceFile: SourceFile;
    line: number;
    column: number;
    paramNames: string[];
    dryRun: boolean;
  }): Promise<{
    success: boolean;
    skipped?: boolean;
    skipReason?: string;
    before?: string;
    after?: string;
    modified?: boolean;
    error?: string;
  }> {
    const { sourceFile, line, column, paramNames, dryRun } = params;

    const callExpr = this.findCallAtPosition(sourceFile, line, column);
    if (!callExpr) {
      return { success: false, error: `No function call found at line ${line}:${column}` };
    }

    const callArgs = callExpr.getArguments();

    // Check if already transformed (single object literal argument)
    if (callArgs.length === 1 && Node.isObjectLiteralExpression(callArgs[0])) {
      return {
        success: false,
        skipped: true,
        skipReason: "Already using object argument",
      };
    }

    // Allow partial matching for optional parameters:
    // callArgs.length can be less than paramNames.length (optional params not provided)
    // but cannot be more than paramNames.length
    if (callArgs.length > paramNames.length) {
      return {
        success: false,
        error: `Too many arguments: call has ${callArgs.length} args, but only ${paramNames.length} param names provided`,
      };
    }

    // Capture all info BEFORE modifying (nodes become invalid after replaceText)
    const argTexts = callArgs.map(a => a.getText());
    const functionName = callExpr.getExpression().getText();
    const argsStart = callArgs[0].getStart();
    const argsEnd = callArgs[callArgs.length - 1].getEnd();

    // Build the new object argument (only include provided arguments)
    // Use shorthand when argument is an identifier matching the property name
    const objectProps = paramNames.slice(0, callArgs.length).map((name, i) => {
      const argText = argTexts[i];
      // Use shorthand if arg is a simple identifier matching the property name
      if (argText === name) {
        return name;
      }
      return `${name}: ${argText}`;
    });
    const newArg = `{ ${objectProps.join(", ")} }`;

    const oldCall = `${functionName}(${argTexts.join(", ")})`;
    const newCall = `${functionName}(${newArg})`;

    let modified = false;
    if (!dryRun) {
      // Apply the transformation (invalidates callExpr node)
      sourceFile.replaceText([argsStart, argsEnd], newArg);
      modified = true;
    }

    return {
      success: true,
      before: oldCall,
      after: newCall,
      modified,
    };
  }

  private findCallAtPosition(
    sourceFile: SourceFile,
    line: number,
    column: number
  ): CallExpression | undefined {
    const position = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
    const nodeAtPosition = sourceFile.getDescendantAtPos(position);
    if (!nodeAtPosition) return undefined;

    let current: Node | undefined = nodeAtPosition;
    while (current) {
      if (Node.isCallExpression(current)) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  /**
   * Phase 1: Collect node information before any modifications.
   * Call this for all operations BEFORE applying any transformations.
   */
  collectNodeInfo(
    sourceFile: SourceFile,
    line: number,
    column: number
  ): CallSiteNodeInfo | { error: string; skipped?: boolean } {
    const node = this.findCallAtPosition(sourceFile, line, column);
    if (!node) {
      return { error: `No function call found at line ${line}:${column}` };
    }

    const callArgs = node.getArguments();

    // Check if already transformed (single object literal argument)
    if (callArgs.length === 1 && Node.isObjectLiteralExpression(callArgs[0])) {
      return { error: "Already using object argument", skipped: true };
    }

    return {
      node,
      sourceFile,
      functionName: node.getExpression().getText(),
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
    paramNames: string[]
  ): CallSitePreparedTransform | { error: string; skipped?: boolean } {
    const callExpr = this.findCallAtPosition(sourceFile, line, column);
    if (!callExpr) {
      return { error: `No function call found at line ${line}:${column}` };
    }

    const callArgs = callExpr.getArguments();

    // Check if already transformed (single object literal argument)
    if (callArgs.length === 1 && Node.isObjectLiteralExpression(callArgs[0])) {
      return { error: "Already using object argument", skipped: true };
    }

    // Allow partial matching for optional parameters
    if (callArgs.length > paramNames.length) {
      return {
        error: `Too many arguments: call has ${callArgs.length} args, but only ${paramNames.length} param names provided`,
      };
    }

    const functionName = callExpr.getExpression().getText();
    const argTexts = callArgs.map(a => a.getText());
    const argsStart = callArgs[0].getStart();
    const argsEnd = callArgs[callArgs.length - 1].getEnd();

    // Build the new object argument (only include provided arguments)
    // Use shorthand when argument is an identifier matching the property name
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

    return {
      start: argsStart,
      end: argsEnd,
      newText: newArg,
      functionName,
      before: oldCall,
      after: newCall,
    };
  }

  /**
   * Phase 2: Apply transformation to a pre-collected node.
   * The node reference remains valid even after other transformations.
   */
  applyToNode(
    nodeInfo: CallSiteNodeInfo,
    paramNames: string[],
    dryRun: boolean
  ): {
    success: boolean;
    before?: string;
    after?: string;
    modified?: boolean;
    error?: string;
  } {
    const { node, sourceFile, functionName } = nodeInfo;

    // Validate node is still accessible
    try {
      node.getArguments();
    } catch {
      return { success: false, error: "Node reference is no longer valid" };
    }

    const callArgs = node.getArguments();

    // Allow partial matching for optional parameters
    if (callArgs.length > paramNames.length) {
      return {
        success: false,
        error: `Too many arguments: call has ${callArgs.length} args, but only ${paramNames.length} param names provided`,
      };
    }

    // Capture all info BEFORE modifying
    const argTexts = callArgs.map(a => a.getText());
    const argsStart = callArgs[0].getStart();
    const argsEnd = callArgs[callArgs.length - 1].getEnd();

    // Build the new object argument (only include provided arguments)
    // Use shorthand when argument is an identifier matching the property name
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

    let modified = false;
    if (!dryRun) {
      sourceFile.replaceText([argsStart, argsEnd], newArg);
      modified = true;
    }

    return {
      success: true,
      before: oldCall,
      after: newCall,
      modified,
    };
  }
}
