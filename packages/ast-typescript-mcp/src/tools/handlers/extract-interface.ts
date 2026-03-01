import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const ExtractInterfaceSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file containing the class"),
  class_name: z.string().describe("Name of the class to extract interface from"),
  interface_name: z.string().optional().describe("Name for the generated interface (default: I{ClassName})"),
});

type ExtractInterfaceArgs = z.infer<typeof ExtractInterfaceSchema>;

export class ExtractInterfaceHandler extends BaseToolHandler<ExtractInterfaceArgs> {
  readonly name = "extract_interface";
  readonly description = "Extract an interface from a class declaration. Returns an InterfaceDeclarationStructure containing public methods and properties.";
  readonly schema = ExtractInterfaceSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file containing the class",
      },
      class_name: {
        type: "string",
        description: "Name of the class to extract interface from",
      },
      interface_name: {
        type: "string",
        description: "Name for the generated interface (default: I{ClassName})",
      },
    },
    required: ["file_path", "class_name"],
  };

  protected async doExecute(args: ExtractInterfaceArgs): Promise<ToolResponse> {
    const { file_path, class_name, interface_name } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.extractInterface({
      filePath: file_path,
      className: class_name,
      interfaceName: interface_name,
    });
    return jsonResponse(result);
  }
}
