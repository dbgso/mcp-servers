import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { classToObject } from "../../codemod/ast-transform.js";

const PropertyMappingSchema = z.object({
  from: z.string().describe("Original property name"),
  to: z.string().describe("Target property name"),
});

const MethodMappingSchema = z.object({
  from: z.string().describe("Original method name"),
  to: z.string().describe("Target property name (will be arrow function)"),
  add_params: z
    .array(z.string())
    .optional()
    .describe("Additional parameters to add (e.g., 'ctx: Context')"),
});

const ClassAdditionsSchema = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

const AstTransformSchema = z.object({
  transform: z
    .enum(["class_to_object"])
    .describe("Transformation type"),
  files: z
    .union([z.string(), z.array(z.string())])
    .describe("File path(s) or glob pattern(s)"),
  class_pattern: z
    .string()
    .optional()
    .describe("Regex to match class names (default: '.*')"),
  property_mappings: z
    .array(PropertyMappingSchema)
    .optional()
    .describe("Property name mappings (e.g., name → id)"),
  method_mappings: z
    .array(MethodMappingSchema)
    .optional()
    .describe("Method to arrow function mappings"),
  remove_properties: z
    .array(z.string())
    .optional()
    .describe("Properties to exclude from output"),
  additions: z
    .record(ClassAdditionsSchema)
    .optional()
    .describe("Per-class additional properties (keyed by class name)"),
  target_type: z
    .string()
    .optional()
    .describe("Type annotation for result (e.g., 'TsOperation<Args>')"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview changes without modifying files (default: true)"),
});

type AstTransformArgs = z.infer<typeof AstTransformSchema>;

export class AstTransformHandler extends BaseToolHandler<AstTransformArgs> {
  readonly name = "ast_transform";
  readonly description =
    "AST-based code transformation. Supports class_to_object: convert class declarations to object literals with property/method mappings. Batch processes multiple files with per-class customization.";
  readonly schema = AstTransformSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      transform: {
        type: "string",
        enum: ["class_to_object"],
        description: "Transformation type",
      },
      files: {
        oneOf: [
          { type: "string", description: "File path or glob pattern" },
          { type: "array", items: { type: "string" }, description: "Array of paths/patterns" },
        ],
        description: "File path(s) or glob pattern(s)",
      },
      class_pattern: {
        type: "string",
        description: "Regex to match class names (default: '.*')",
      },
      property_mappings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
          required: ["from", "to"],
        },
        description: "Property name mappings",
      },
      method_mappings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            add_params: { type: "array", items: { type: "string" } },
          },
          required: ["from", "to"],
        },
        description: "Method to arrow function mappings",
      },
      remove_properties: {
        type: "array",
        items: { type: "string" },
        description: "Properties to exclude",
      },
      additions: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: true,
        },
        description: "Per-class additional properties",
      },
      target_type: {
        type: "string",
        description: "Type annotation for result",
      },
      dry_run: {
        type: "boolean",
        description: "Preview without modifying (default: true)",
      },
    },
    required: ["transform", "files"],
  };

  protected async doExecute(args: AstTransformArgs): Promise<ToolResponse> {
    const {
      transform,
      files,
      class_pattern,
      property_mappings,
      method_mappings,
      remove_properties,
      additions,
      target_type,
      dry_run,
    } = args;

    if (transform === "class_to_object") {
      try {
        const result = await classToObject({
          files,
          classPattern: class_pattern,
          propertyMappings: property_mappings?.map(m => ({
            from: m.from,
            to: m.to,
          })),
          methodMappings: method_mappings?.map(m => ({
            from: m.from,
            to: m.to,
            addParams: m.add_params,
          })),
          removeProperties: remove_properties,
          additions,
          targetType: target_type,
          dryRun: dry_run,
        });

        return jsonResponse(result);
      } catch (error) {
        return errorResponse(
          `AST transform failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return errorResponse(`Unknown transform type: ${transform}`);
  }
}
