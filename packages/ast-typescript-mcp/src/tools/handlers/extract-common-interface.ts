import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const ExtractCommonInterfaceSchema = z.object({
  source_files: z
    .union([z.string(), z.array(z.string())])
    .describe("Source files containing classes (glob pattern or paths)"),
  interface_name: z.string().describe("Name for the generated interface"),
  class_pattern: z
    .string()
    .optional()
    .describe("Regex pattern to match class names"),
  include_methods: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include methods in the interface (default: true)"),
  include_properties: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include properties in the interface (default: true)"),
  min_occurrence: z
    .number()
    .optional()
    .default(0.5)
    .describe(
      "Minimum occurrence ratio for a member to be included (0-1, default: 0.5 = present in at least 50% of classes)"
    ),
});

type ExtractCommonInterfaceArgs = z.infer<typeof ExtractCommonInterfaceSchema>;

export class ExtractCommonInterfaceHandler extends BaseToolHandler<ExtractCommonInterfaceArgs> {
  readonly name = "extract_common_interface";
  readonly description =
    "Analyze multiple classes to find common methods and properties, then generate an interface containing shared members. Useful for refactoring to introduce polymorphism.";
  readonly schema = ExtractCommonInterfaceSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      source_files: {
        oneOf: [
          { type: "string", description: "Glob pattern or single file path" },
          {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths",
          },
        ],
        description: "Source files containing classes",
      },
      interface_name: {
        type: "string",
        description: "Name for the generated interface",
      },
      class_pattern: {
        type: "string",
        description: "Regex pattern to match class names",
      },
      include_methods: {
        type: "boolean",
        description: "Include methods (default: true)",
      },
      include_properties: {
        type: "boolean",
        description: "Include properties (default: true)",
      },
      min_occurrence: {
        type: "number",
        description: "Minimum occurrence ratio (0-1, default: 0.5)",
      },
    },
    required: ["source_files", "interface_name"],
  };

  protected async doExecute(args: ExtractCommonInterfaceArgs): Promise<ToolResponse> {
    const {
      source_files,
      interface_name,
      class_pattern,
      include_methods,
      include_properties,
      min_occurrence,
    } = args;

    // Get handler from first file or use default typescript handler
    const firstFile = Array.isArray(source_files) ? source_files[0] : source_files;
    const handler = getHandler(firstFile.includes("*") ? "dummy.ts" : firstFile);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.extractCommonInterface({
      sourceFiles: source_files,
      interfaceName: interface_name,
      classPattern: class_pattern,
      includeMethods: include_methods,
      includeProperties: include_properties,
      minOccurrence: min_occurrence,
    });
    return jsonResponse(result);
  }
}
