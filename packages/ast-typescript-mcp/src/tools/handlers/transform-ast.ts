/**
 * AST-based code transformation tool.
 *
 * Supports two modes:
 * 1. Query-based: Use AST queries to find and replace patterns
 * 2. Preset-based: Use predefined transformations (e.g., class_to_object)
 */

import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { QueryEngine, QUERY_PRESETS } from "../../query/engine.js";
import type { AstQuery, AstQueryBase, QueryMatch, CapturedNode } from "../../query/engine.js";
import { classToObject } from "../../codemod/ast-transform.js";
import { Project } from "ts-morph";
import { writeFileSync } from "node:fs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportSpec {
  from: string;
  named?: string[];
  default?: string;
}

interface TransformChange {
  file: string;
  line: number;
  column: number;
  original: string;
  replacement: string;
}

interface TransformResult {
  mode: "query" | "preset";
  changes: TransformChange[];
  filesModified: number;
  totalMatches: number;
  importsAdded: { file: string; imports: ImportSpec[] }[];
  dryRun: boolean;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const AstQueryBaseSchema: z.ZodType<AstQueryBase> = z.lazy(() =>
  z.object({
    kind: z.string().optional(),
    $capture: z.string().optional(),
    $text: z.string().optional(),
    $any: z.literal(true).optional(),
  }).catchall(z.union([z.lazy(() => AstQueryBaseSchema), z.string(), z.boolean()]))
);

const AstQuerySchema: z.ZodType<AstQuery> = AstQueryBaseSchema.refine(
  (data) => data.kind !== undefined,
  { message: "Root query must have 'kind' property" }
) as z.ZodType<AstQuery>;

const ImportSpecSchema = z.object({
  from: z.string().describe("Module path (e.g., 'mcp-shared')"),
  named: z.array(z.string()).optional().describe("Named exports to import"),
  default: z.string().optional().describe("Default import name"),
});

const PropertyMappingSchema = z.object({
  from: z.string(),
  to: z.string(),
});

const MethodMappingSchema = z.object({
  from: z.string(),
  to: z.string(),
  add_params: z.array(z.string()).optional(),
});

const TransformAstSchema = z.object({
  path: z.string().describe("File or directory path to transform"),

  // Query-based transformation
  query: AstQuerySchema.optional().describe("AST query to match patterns"),
  query_preset: z.enum([
    "instanceof",
    "console_log",
    "await_then",
    "non_null_assertion",
    "type_assertion",
    "any_type",
    "instanceof_error_ternary",
  ]).optional().describe("Use a preset query"),
  replacement: z.string().optional().describe("Replacement template using ${capture} syntax"),
  add_imports: z.array(ImportSpecSchema).optional().describe("Imports to add when replacement is applied"),

  // Preset-based transformation (class_to_object)
  preset: z.enum(["class_to_object"]).optional().describe("Predefined transformation"),
  class_pattern: z.string().optional().describe("Regex for class names (class_to_object)"),
  property_mappings: z.array(PropertyMappingSchema).optional(),
  method_mappings: z.array(MethodMappingSchema).optional(),
  remove_properties: z.array(z.string()).optional(),
  additions: z.record(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional(),
  target_type: z.string().optional(),

  // Common options
  include: z.array(z.string()).optional().default(["**/*.ts", "**/*.tsx"]),
  exclude: z.array(z.string()).optional().default(["**/node_modules/**", "**/*.d.ts", "**/__tests__/**"]),
  dry_run: z.boolean().optional().default(true).describe("Preview without modifying (default: true)"),
}).refine(
  (data) => data.query !== undefined || data.query_preset !== undefined || data.preset !== undefined,
  { message: "Either 'query', 'query_preset', or 'preset' must be provided" }
).refine(
  (data) => {
    if ((data.query || data.query_preset) && !data.replacement) {
      return false;
    }
    return true;
  },
  { message: "'replacement' is required when using query-based transformation" }
);

type TransformAstArgs = z.infer<typeof TransformAstSchema>;

// ─── Handler ─────────────────────────────────────────────────────────────────

export class TransformAstHandler extends BaseToolHandler<TransformAstArgs> {
  readonly name = "transform_ast";
  readonly description = `AST-based code transformation with pattern matching.

## Can Do
- Find pattern and replace: \`query\` + \`replacement\`
- Use captures in replacement: \`\${errorVar}\`
- Auto-add imports: \`add_imports\`
- Class to object transformation: \`preset: "class_to_object"\`

## Cannot Do
- Complex multi-node transformations
- Preserve exact whitespace/formatting
- Cross-file transformations in one call (use batch)

## Query-based Example
\`\`\`json
ts_ast(action: "transform",
  path: "src/",
  query_preset: "instanceof_error_ternary",
  replacement: "getErrorMessage(\${errorVar})",
  add_imports: [{ from: "mcp-shared", named: ["getErrorMessage"] }],
  dry_run: false)
\`\`\`
Transforms: \`e instanceof Error ? e.message : String(e)\` → \`getErrorMessage(e)\`

## Presets
instanceof, console_log, await_then, non_null_assertion, type_assertion, any_type, instanceof_error_ternary`;
  readonly schema = TransformAstSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "File or directory to transform" },
      query: { type: "object", description: "AST query with $capture for replacement" },
      query_preset: {
        type: "string",
        enum: ["instanceof", "console_log", "await_then", "non_null_assertion", "type_assertion", "any_type", "instanceof_error_ternary"],
        description: "Preset query",
      },
      replacement: { type: "string", description: "Replacement template (e.g., 'getErrorMessage(${errorVar})')" },
      add_imports: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            named: { type: "array", items: { type: "string" } },
            default: { type: "string" },
          },
          required: ["from"],
        },
        description: "Imports to add",
      },
      preset: { type: "string", enum: ["class_to_object"], description: "Preset transformation" },
      class_pattern: { type: "string", description: "Regex for class names" },
      property_mappings: { type: "array", description: "Property mappings for class_to_object" },
      method_mappings: { type: "array", description: "Method mappings for class_to_object" },
      remove_properties: { type: "array", items: { type: "string" } },
      additions: { type: "object" },
      target_type: { type: "string" },
      include: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
      dry_run: { type: "boolean", description: "Preview without modifying (default: true)" },
    },
    required: ["path"],
  };

  protected async doExecute(args: TransformAstArgs): Promise<ToolResponse> {
    try {
      // Preset-based transformation (class_to_object)
      if (args.preset === "class_to_object") {
        return this.executeClassToObject(args);
      }

      // Query-based transformation
      return this.executeQueryTransform(args);
    } catch (error) {
      return errorResponse(`transform_ast failed: ${getErrorMessage(error)}`);
    }
  }

  private async executeClassToObject(args: TransformAstArgs): Promise<ToolResponse> {
    const result = await classToObject({
      files: args.path,
      classPattern: args.class_pattern,
      propertyMappings: args.property_mappings?.map(m => ({ from: m.from, to: m.to })),
      methodMappings: args.method_mappings?.map(m => ({
        from: m.from,
        to: m.to,
        addParams: m.add_params,
      })),
      removeProperties: args.remove_properties,
      additions: args.additions,
      targetType: args.target_type,
      dryRun: args.dry_run,
    });

    return jsonResponse({ mode: "preset", preset: "class_to_object", ...result });
  }

  private async executeQueryTransform(args: TransformAstArgs): Promise<ToolResponse> {
    const query = args.query_preset ? QUERY_PRESETS[args.query_preset] : args.query!;
    const replacement = args.replacement!;

    const engine = new QueryEngine();
    const searchResult = await engine.search({
      searchPath: args.path,
      query,
      include: args.include,
      exclude: args.exclude,
      limit: 1000,
    });

    if (searchResult.matches.length === 0) {
      return jsonResponse({
        mode: "query",
        changes: [],
        filesModified: 0,
        totalMatches: 0,
        importsAdded: [],
        dryRun: args.dry_run,
        message: "No matches found",
      });
    }

    // Group matches by file
    const matchesByFile = new Map<string, QueryMatch[]>();
    for (const match of searchResult.matches) {
      const existing = matchesByFile.get(match.file) || [];
      existing.push(match);
      matchesByFile.set(match.file, existing);
    }

    const changes: TransformChange[] = [];
    const importsAdded: { file: string; imports: ImportSpec[] }[] = [];

    // Process each file
    const project = new Project({ skipAddingFilesFromTsConfig: true });

    for (const [filePath, matches] of matchesByFile) {
      const sourceFile = project.addSourceFileAtPath(filePath);
      const fileChanges: TransformChange[] = [];

      // Sort matches by position (descending) to apply from end to start
      const sortedMatches = [...matches].sort((a, b) => {
        if (a.line !== b.line) return b.line - a.line;
        return b.column - a.column;
      });

      for (const match of sortedMatches) {
        const replacementText = this.interpolateTemplate(replacement, match.captures);
        fileChanges.push({
          file: filePath,
          line: match.line,
          column: match.column,
          original: match.text,
          replacement: replacementText,
        });

        if (!args.dry_run) {
          // Find the node again and replace it
          const node = this.findNodeAtPosition(sourceFile, match.line, match.column, match.kind);
          if (node) {
            node.replaceWithText(replacementText);
          }
        }
      }

      // Add imports if needed
      if (args.add_imports && args.add_imports.length > 0 && fileChanges.length > 0) {
        if (!args.dry_run) {
          for (const importSpec of args.add_imports) {
            this.addImport(sourceFile, importSpec);
          }
        }
        importsAdded.push({ file: filePath, imports: args.add_imports });
      }

      if (!args.dry_run) {
        writeFileSync(filePath, sourceFile.getFullText());
      }

      changes.push(...fileChanges);
      project.removeSourceFile(sourceFile);
    }

    const result: TransformResult = {
      mode: "query",
      changes,
      filesModified: matchesByFile.size,
      totalMatches: searchResult.matches.length,
      importsAdded,
      dryRun: args.dry_run ?? true,
    };

    return jsonResponse(result);
  }

  private interpolateTemplate(template: string, captures: Record<string, CapturedNode>): string {
    return template.replace(/\$\{(\w+)\}/g, (_, name) => {
      const captured = captures[name];
      return captured ? captured.text : `\${${name}}`;
    });
  }

  private findNodeAtPosition(
    sourceFile: ReturnType<Project["addSourceFileAtPath"]>,
    line: number,
    column: number,
    expectedKind: string
  ) {
    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);

    // Find all descendants at this position and match by kind
    let result = sourceFile.getDescendantAtPos(pos);
    if (!result) return undefined;

    // Walk up to find the node with the expected kind
    while (result) {
      if (result.getKindName() === expectedKind) {
        return result;
      }
      const parent = result.getParent();
      if (!parent || parent === sourceFile) break;
      result = parent;
    }

    // If not found walking up, try the original node
    return sourceFile.getDescendantAtPos(pos);
  }

  private addImport(sourceFile: ReturnType<Project["addSourceFileAtPath"]>, importSpec: ImportSpec): void {
    const existingImport = sourceFile.getImportDeclaration(importSpec.from);

    if (existingImport) {
      // Add to existing import
      if (importSpec.named) {
        for (const name of importSpec.named) {
          const existing = existingImport.getNamedImports().find(n => n.getName() === name);
          if (!existing) {
            existingImport.addNamedImport(name);
          }
        }
      }
    } else {
      // Add new import
      const importStructure: { moduleSpecifier: string; namedImports?: string[]; defaultImport?: string } = {
        moduleSpecifier: importSpec.from,
      };
      if (importSpec.named) {
        importStructure.namedImports = importSpec.named;
      }
      if (importSpec.default) {
        importStructure.defaultImport = importSpec.default;
      }
      sourceFile.addImportDeclaration(importStructure);
    }
  }
}
