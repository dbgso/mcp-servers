import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse, BatchChange, BatchOperationResult } from "../types.js";
import { Project } from "ts-morph";
import type { SourceFile } from "ts-morph";
import { TransformSignatureHandler } from "./transform-signature.js";
import { TransformCallSiteHandler } from "./transform-call-site.js";

/**
 * Allowed tools for batch execution (security restriction)
 */
const ALLOWED_TOOLS = ["transform_signature", "transform_call_site"] as const;
type AllowedTool = (typeof ALLOWED_TOOLS)[number];

const OperationSchema = z.object({
  tool: z.enum(ALLOWED_TOOLS).describe("Tool to execute"),
  args: z.record(z.unknown()).describe("Arguments for the tool"),
});

const BatchExecuteSchema = z.object({
  operations: z
    .array(OperationSchema)
    .min(1)
    .describe("List of operations to execute in order"),
  mode: z
    .enum(["preview", "execute"])
    .default("preview")
    .describe("preview: dry run all operations, execute: apply changes"),
  stop_on_error: z
    .boolean()
    .optional()
    .default(true)
    .describe("Stop execution on first error (default: true)"),
});

type BatchExecuteArgs = z.infer<typeof BatchExecuteSchema>;

interface BatchExecuteResult {
  success: boolean;
  mode: "preview" | "execute";
  completed: number;
  total: number;
  results: BatchOperationResult[];
  changes: BatchChange[];
  stoppedAt?: number;
}

/**
 * Prepared transformation from Phase 1.
 * Contains text positions and replacement text, NOT node references.
 * This allows batch application without node invalidation issues.
 */
interface PreparedTransform {
  tool: AllowedTool;
  filePath: string;
  originalLine: number;
  /** Start position in the source text */
  start: number;
  /** End position in the source text */
  end: number;
  /** Text to replace with */
  newText: string;
  /** Description for reporting */
  description: string;
  /** Before text for diff display */
  before: string;
  /** After text for diff display */
  after: string;
}

export class BatchExecuteHandler extends BaseToolHandler<BatchExecuteArgs> {
  readonly name = "batch_execute";
  readonly description =
    "Execute multiple AST transformations atomically. All operations share a single Project instance, ensuring consistent line numbers across changes. Use mode='preview' first to review changes, then mode='execute' to apply.";
  readonly schema = BatchExecuteSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              enum: ALLOWED_TOOLS,
              description: "Tool to execute",
            },
            args: {
              type: "object",
              description: "Arguments for the tool",
            },
          },
          required: ["tool", "args"],
        },
        description: "List of operations to execute in order",
      },
      mode: {
        type: "string",
        enum: ["preview", "execute"],
        description: "preview: dry run all operations, execute: apply changes",
      },
      stop_on_error: {
        type: "boolean",
        description: "Stop execution on first error (default: true)",
      },
    },
    required: ["operations"],
  };

  // Handlers for each tool
  private transformSignatureHandler = new TransformSignatureHandler();
  private transformCallSiteHandler = new TransformCallSiteHandler();

  protected async doExecute(args: BatchExecuteArgs): Promise<ToolResponse> {
    const { operations, mode, stop_on_error } = args;
    const dryRun = mode === "preview";

    // Create shared Project instance
    const project = new Project();
    const sourceFiles = new Map<string, SourceFile>();

    const getSourceFile = (filePath: string): SourceFile => {
      let sf = sourceFiles.get(filePath);
      if (!sf) {
        sf = project.addSourceFileAtPath(filePath);
        sourceFiles.set(filePath, sf);
      }
      return sf;
    };

    // ============================================================
    // PHASE 1: Prepare all transformations (collect text positions)
    // This captures positions BEFORE any modifications
    // ============================================================
    const prepared: PreparedTransform[] = [];
    const prepareErrors: BatchOperationResult[] = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const opArgs = op.args as Record<string, unknown>;
      const filePath = (opArgs.file_path as string) || "";
      const line = (opArgs.line as number) || 0;
      const column = (opArgs.column as number) || 0;

      try {
        const sourceFile = getSourceFile(filePath);

        if (op.tool === "transform_signature") {
          const result = this.transformSignatureHandler.prepareTransform(
            sourceFile,
            line,
            column,
            opArgs.new_params as Array<{ name: string; type: string; optional?: boolean }>
          );

          if ("error" in result) {
            prepareErrors.push({
              tool: op.tool,
              filePath,
              success: false,
              error: result.error,
            });
            if (stop_on_error) break;
            continue;
          }

          prepared.push({
            tool: "transform_signature",
            filePath,
            originalLine: line,
            start: result.start,
            end: result.end,
            newText: result.newText,
            description: `transform_signature: ${result.functionName}`,
            before: result.before,
            after: result.after,
          });
        } else if (op.tool === "transform_call_site") {
          const result = this.transformCallSiteHandler.prepareTransform(
            sourceFile,
            line,
            column,
            opArgs.param_names as string[]
          );

          if ("error" in result) {
            // Skipped nodes are not errors, just skip them
            if (result.skipped) {
              continue;
            }
            prepareErrors.push({
              tool: op.tool,
              filePath,
              success: false,
              error: result.error,
            });
            if (stop_on_error) break;
            continue;
          }

          prepared.push({
            tool: "transform_call_site",
            filePath,
            originalLine: line,
            start: result.start,
            end: result.end,
            newText: result.newText,
            description: `transform_call_site: ${result.functionName}`,
            before: result.before,
            after: result.after,
          });
        }
      } catch (error) {
        prepareErrors.push({
          tool: op.tool,
          filePath,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        if (stop_on_error) break;
      }
    }

    // If there were preparation errors and stop_on_error, return early
    if (prepareErrors.length > 0 && stop_on_error) {
      return jsonResponse({
        success: false,
        mode,
        completed: 0,
        total: operations.length,
        results: prepareErrors,
        changes: [],
        phase: "preparation",
      });
    }

    // ============================================================
    // PHASE 2: Apply transformations using text positions
    // Sort by start position DESCENDING within each file (bottom-up)
    // This ensures earlier transforms don't shift positions of later ones
    // ============================================================
    const results: BatchOperationResult[] = [];
    const changes: BatchChange[] = [];

    // Sort by file path, then by start position descending (bottom-up)
    const sorted = [...prepared].sort((a, b) => {
      if (a.filePath !== b.filePath) {
        return a.filePath.localeCompare(b.filePath);
      }
      // Sort by start position descending (apply from end of file first)
      return b.start - a.start;
    });

    if (!dryRun) {
      // Apply all transformations
      for (const transform of sorted) {
        try {
          const sourceFile = sourceFiles.get(transform.filePath);
          if (!sourceFile) {
            results.push({
              tool: transform.tool,
              filePath: transform.filePath,
              success: false,
              error: "Source file not found in cache",
            });
            if (stop_on_error) break;
            continue;
          }

          sourceFile.replaceText([transform.start, transform.end], transform.newText);

          const change: BatchChange = {
            filePath: transform.filePath,
            line: transform.originalLine,
            description: transform.description,
            before: transform.before,
            after: transform.after,
          };
          changes.push(change);
          results.push({
            tool: transform.tool,
            filePath: transform.filePath,
            success: true,
            change,
          });
        } catch (error) {
          results.push({
            tool: transform.tool,
            filePath: transform.filePath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          if (stop_on_error) break;
        }
      }

      // Save all modified files
      if (results.every(r => r.success)) {
        try {
          await project.save();
        } catch (error) {
          return errorResponse(
            `Failed to save changes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else {
      // Preview mode: just report changes without applying
      for (const transform of sorted) {
        const change: BatchChange = {
          filePath: transform.filePath,
          line: transform.originalLine,
          description: transform.description,
          before: transform.before,
          after: transform.after,
        };
        changes.push(change);
        results.push({
          tool: transform.tool,
          filePath: transform.filePath,
          success: true,
          change,
        });
      }
    }

    const batchResult: BatchExecuteResult = {
      success: results.every(r => r.success) && prepareErrors.length === 0,
      mode,
      completed: results.filter(r => r.success).length,
      total: operations.length,
      results: [...prepareErrors, ...results],
      changes,
    };

    return jsonResponse(batchResult);
  }
}
