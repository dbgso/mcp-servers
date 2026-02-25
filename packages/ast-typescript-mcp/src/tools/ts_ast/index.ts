import { z } from "zod";
import { BaseToolHandler, ActionRegistry } from "mcp-shared";
import type { RegistrableActionHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";

// Import existing handlers
import {
  TsStructureReadHandler,
  TsStructureWriteHandler,
  GoToDefinitionHandler,
  HoverHandler,
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
  wrapHandler({ action: "hover", handler: new HoverHandler() }),
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
  return `# ts_ast

TypeScript AST operations - structural code search and transformation.

## When to Use (vs grep)

| Task | grep | ts_ast |
|------|------|--------|
| Find text "execute" | ✓ | - |
| Find function calls to \`execute\` | ✗ | ✓ query |
| Find function definitions named \`*Handler\` | ✗ | ✓ query |
| Rename symbol project-wide | ✗ | ✓ rename |
| Transform call site arguments | ✗ | ✓ transform_call_site |
| Find unused code | ✗ | ✓ dead_code |

**Use ts_ast when you need structure-aware operations.**

## Action Categories

### Search & Analysis
- **query** - AST pattern search (e.g., find all CallExpressions)
- **find_blocks** - Find code blocks by pattern
- **references** - Find all references to a symbol
- **definition** - Go to definition
- **call_graph** - Analyze function call relationships
- **dead_code** - Find unused exports
- **type_check** - Run TypeScript type checker

### Transform
- **transform** - Pattern-based AST transformation
- **transform_call_site** - Transform function call arguments
- **rename** - Rename symbol across project
- **remove_nodes** - Remove AST nodes by pattern
- **remove_unused_imports** - Clean up imports

### Batch Operations
- **batch** - Execute multiple actions atomically

### Structure
- **read** - Read file structure (functions, classes, etc.)
- **write** - Write/modify code structure
- **dependency_graph** - Module dependency analysis
- **monorepo_graph** - Monorepo package relationships

## Examples

### Find all function calls to \`execute\`
\`\`\`
ts_ast(action: "query", pattern: "CallExpression[expression.name.text=execute]", path: "src/")
\`\`\`

### Rename symbol
\`\`\`
ts_ast(action: "rename", file: "src/foo.ts", line: 10, column: 5, newName: "newSymbolName")
\`\`\`

### Transform call site (e.g., add object wrapper)
\`\`\`
ts_ast(action: "transform_call_site",
  file: "src/test.ts",
  callee: "handler.execute",
  transform: "({ rawParams: $1, context: $2 })")
\`\`\`

### Batch transform multiple files
\`\`\`
ts_ast(action: "batch", operations: [
  { action: "transform_call_site", file: "a.ts", callee: "foo", transform: "..." },
  { action: "transform_call_site", file: "b.ts", callee: "foo", transform: "..." }
])
\`\`\`

## Usage
\`\`\`
ts_ast(action: "<action>", ...)
ts_ast(help: true)
ts_ast(action: "<action>", help: true)  # Action-specific help
\`\`\`
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
  readonly description = "TypeScript structural code search & transform. Use instead of grep for: finding function calls/definitions, renaming symbols, transforming call sites. Call with help:true for examples.";
  readonly schema = TsAstSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        description: "Action: query (AST search), transform (AST transform), transform_call_site (call arg transform), rename (symbol rename), batch (multi-op), references, definition, dead_code, etc.",
      },
      help: {
        type: "boolean",
        description: "Show help with examples. Use with action for action-specific help.",
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
