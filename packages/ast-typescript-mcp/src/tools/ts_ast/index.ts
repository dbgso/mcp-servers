import { z } from "zod";
import { BaseToolHandler, ActionRegistry } from "mcp-shared";
import type { RegistrableActionHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";

// Import existing handlers
import {
  TsStructureReadHandler,
  TsStructureWriteHandler,
  GoToDefinitionHandler,
  FindReferencesHandler,
  CallGraphHandler,
  TypeHierarchyHandler,
  ExtractInterfaceHandler,
  DiffStructureHandler,
  DependencyGraphHandler,
  RenameSymbolHandler,
  DeadCodeHandler,
  QueryGraphHandler,
  TypeCheckHandler,
  AutoImportHandler,
  InlineTypeHandler,
  ExtractCommonInterfaceHandler,
  TransformAstHandler,
  TransformSignatureHandler,
  TransformCallSiteHandler,
  MonorepoGraphHandler,
  PackageDependentsHandler,
  BatchExecuteHandler,
  FindBlocksHandler,
  RemoveNodesHandler,
  RemoveUnusedImportsHandler,
  QueryAstHandler,
} from "../handlers/index.js";

// ─── Context ─────────────────────────────────────────────────────────────────

 
interface TsAstContext {}

// ─── Adapter ─────────────────────────────────────────────────────────────────

function wrapHandler(params: {
  action: string;
  handler: { description: string; execute: (args: unknown) => Promise<ToolResponse> };
}): RegistrableActionHandler<TsAstContext> {
  const { action, handler } = params;
  return {
    action,
    help: `# ts_ast ${action}\n\n${handler.description}`,
    execute(executeParams: { rawParams: unknown; context: TsAstContext }): Promise<ToolResponse> {
      return handler.execute(executeParams.rawParams);
    },
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = new ActionRegistry<TsAstContext>();

registry.registerAll([
  wrapHandler({ action: "read", handler: new TsStructureReadHandler() }),
  wrapHandler({ action: "write", handler: new TsStructureWriteHandler() }),
  wrapHandler({ action: "definition", handler: new GoToDefinitionHandler() }),
  wrapHandler({ action: "references", handler: new FindReferencesHandler() }),
  wrapHandler({ action: "call_graph", handler: new CallGraphHandler() }),
  wrapHandler({ action: "type_hierarchy", handler: new TypeHierarchyHandler() }),
  wrapHandler({ action: "extract_interface", handler: new ExtractInterfaceHandler() }),
  wrapHandler({ action: "diff", handler: new DiffStructureHandler() }),
  wrapHandler({ action: "dependency_graph", handler: new DependencyGraphHandler() }),
  wrapHandler({ action: "rename", handler: new RenameSymbolHandler() }),
  wrapHandler({ action: "dead_code", handler: new DeadCodeHandler() }),
  wrapHandler({ action: "query_graph", handler: new QueryGraphHandler() }),
  wrapHandler({ action: "type_check", handler: new TypeCheckHandler() }),
  wrapHandler({ action: "auto_import", handler: new AutoImportHandler() }),
  wrapHandler({ action: "inline_type", handler: new InlineTypeHandler() }),
  wrapHandler({ action: "extract_common_interface", handler: new ExtractCommonInterfaceHandler() }),
  wrapHandler({ action: "transform", handler: new TransformAstHandler() }),
  wrapHandler({ action: "transform_signature", handler: new TransformSignatureHandler() }),
  wrapHandler({ action: "transform_call_site", handler: new TransformCallSiteHandler() }),
  wrapHandler({ action: "monorepo_graph", handler: new MonorepoGraphHandler() }),
  wrapHandler({ action: "package_dependents", handler: new PackageDependentsHandler() }),
  wrapHandler({ action: "batch", handler: new BatchExecuteHandler() }),
  wrapHandler({ action: "find_blocks", handler: new FindBlocksHandler() }),
  wrapHandler({ action: "remove_nodes", handler: new RemoveNodesHandler() }),
  wrapHandler({ action: "remove_unused_imports", handler: new RemoveUnusedImportsHandler() }),
  wrapHandler({ action: "query", handler: new QueryAstHandler() }),
]);

// ─── Help ────────────────────────────────────────────────────────────────────

function generateHelp(): string {
  const actionList = registry.getActions().map((a) => `- **${a}**`).join("\n");
  return `# ts_ast

TypeScript AST operations tool.

## Actions
${actionList}

## Usage
\`\`\`
ts_ast(action: "<action>", ...)
ts_ast(help: true)
ts_ast(action: "<action>", help: true)
\`\`\`

Use \`help: true\` with an action to see detailed help for that action.
`;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const TsAstSchema = z.object({
  action: z.string().optional().describe("Action to perform"),
  help: z.boolean().optional().describe("Show help"),
}).passthrough();

type TsAstArgs = z.infer<typeof TsAstSchema>;

// ─── Handler ─────────────────────────────────────────────────────────────────

export class TsAstHandler extends BaseToolHandler<TsAstArgs> {
  readonly name = "ts_ast";
  readonly description = "TypeScript AST operations: read, query, transform, and more. Call with help:true for usage.";
  readonly schema = TsAstSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        description: "Action to perform (read, query, transform, etc.)",
      },
      help: {
        type: "boolean",
        description: "Show help. Use with action to see action-specific help.",
      },
    },
  };

  protected async doExecute(args: TsAstArgs): Promise<ToolResponse> {
    const { action, help, ...rest } = args;

    // Show general help
    if (help && !action) {
      return { content: [{ type: "text" as const, text: generateHelp() }] };
    }

    // No action provided
    if (!action) {
      return { content: [{ type: "text" as const, text: generateHelp() }] };
    }

    // Resolve handler
    const handler = registry.getHandler(action);
    if (!handler) {
      const availableActions = registry.getActions().join(", ");
      return {
        content: [{
          type: "text" as const,
          text: `Error: Unknown action "${action}". Available: ${availableActions}`,
        }],
        isError: true,
      };
    }

    // Show action-specific help
    if (help) {
      return { content: [{ type: "text" as const, text: handler.help }] };
    }

    // Execute action handler
    return handler.execute({ rawParams: rest, context: {} });
  }
}
