import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { Project, Node } from "ts-morph";
import type { SourceFile, ImportDeclaration } from "ts-morph";

const TsRemoveUnusedImportsSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview changes without modifying file (default: true)"),
  organize: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also organize/sort remaining imports (default: false)"),
});

type TsRemoveUnusedImportsArgs = z.infer<typeof TsRemoveUnusedImportsSchema>;

interface RemovedImport {
  module: string;
  specifiers: string[];
  line: number;
  entireDeclaration: boolean;
}

interface RemoveUnusedImportsResult {
  filePath: string;
  dryRun: boolean;
  removedImports: RemovedImport[];
  totalRemoved: number;
  organized: boolean;
  summary: string;
}

export class RemoveUnusedImportsHandler extends BaseToolHandler<TsRemoveUnusedImportsArgs> {
  readonly name = "ts_remove_unused_imports";
  readonly description =
    "Remove unused imports from a TypeScript file. Detects imports that are not referenced " +
    "anywhere in the file and removes them. Can optionally organize remaining imports.";
  readonly schema = TsRemoveUnusedImportsSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file",
      },
      dry_run: {
        type: "boolean",
        description: "Preview changes without modifying file (default: true)",
      },
      organize: {
        type: "boolean",
        description: "Also organize/sort remaining imports (default: false)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: TsRemoveUnusedImportsArgs): Promise<ToolResponse> {
    const { file_path, dry_run, organize } = args;

    try {
      const project = new Project({ skipAddingFilesFromTsConfig: true });
      const sourceFile = project.addSourceFileAtPath(file_path);

      const removedImports = this.findAndRemoveUnusedImports({ sourceFile, dryRun: dry_run });

      if (organize && !dry_run) {
        sourceFile.organizeImports();
      }

      if (!dry_run && removedImports.length > 0) {
        await sourceFile.save();
      }

      const result: RemoveUnusedImportsResult = {
        filePath: file_path,
        dryRun: dry_run,
        removedImports,
        totalRemoved: removedImports.reduce((sum, r) => sum + r.specifiers.length, 0),
        organized: organize && !dry_run,
        summary: this.buildSummary({ removedImports, dryRun: dry_run, organized: organize }),
      };

      return jsonResponse(result);
    } catch (error) {
      return errorResponse(
        `ts_remove_unused_imports failed: ${getErrorMessage(error)}`
      );
    }
  }

  private findAndRemoveUnusedImports(params: {
    sourceFile: SourceFile;
    dryRun: boolean;
  }): RemovedImport[] {
    const { sourceFile, dryRun } = params;
    const removedImports: RemovedImport[] = [];
    const importDeclarations = sourceFile.getImportDeclarations();

    // Collect all imports to remove (phase 1)
    const toRemove: Array<{
      decl: ImportDeclaration;
      module: string;
      line: number;
      unusedSpecifiers: string[];
      removeEntire: boolean;
    }> = [];

    for (const importDecl of importDeclarations) {
      const module = importDecl.getModuleSpecifierValue();
      const line = importDecl.getStartLineNumber();
      const unusedSpecifiers: string[] = [];
      let hasUsedSpecifiers = false;

      // Check default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const refs = defaultImport.findReferencesAsNodes();
        // First reference is the declaration itself
        if (refs.length <= 1) {
          unusedSpecifiers.push(defaultImport.getText());
        } else {
          hasUsedSpecifiers = true;
        }
      }

      // Check namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const refs = namespaceImport.findReferencesAsNodes();
        if (refs.length <= 1) {
          unusedSpecifiers.push(`* as ${namespaceImport.getText()}`);
        } else {
          hasUsedSpecifiers = true;
        }
      }

      // Check named imports
      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        // Use alias node if present (import { x as y }), otherwise use name node
        const refNode = namedImport.getAliasNode() ?? namedImport.getNameNode();
        // Only Identifier nodes support findReferencesAsNodes
        if (Node.isIdentifier(refNode)) {
          const refs = refNode.findReferencesAsNodes();
          if (refs.length <= 1) {
            unusedSpecifiers.push(namedImport.getName());
          } else {
            hasUsedSpecifiers = true;
          }
        } else {
          // StringLiteral imports are rare, assume used for safety
          hasUsedSpecifiers = true;
        }
      }

      // Side-effect only imports (import "module") are always kept
      if (!defaultImport && !namespaceImport && namedImports.length === 0) {
        continue;
      }

      if (unusedSpecifiers.length > 0) {
        toRemove.push({
          decl: importDecl,
          module,
          line,
          unusedSpecifiers,
          removeEntire: !hasUsedSpecifiers,
        });
      }
    }

    // Phase 2: Apply removals (in reverse order to preserve line numbers)
    toRemove.sort((a, b) => b.line - a.line);

    for (const item of toRemove) {
      removedImports.push({
        module: item.module,
        specifiers: item.unusedSpecifiers,
        line: item.line,
        entireDeclaration: item.removeEntire,
      });

      if (!dryRun) {
        if (item.removeEntire) {
          item.decl.remove();
        } else {
          // Remove only unused specifiers
          this.removeUnusedSpecifiers({ decl: item.decl, unusedSpecifiers: item.unusedSpecifiers });
        }
      }
    }

    // Sort results by original line number for readability
    removedImports.sort((a, b) => a.line - b.line);

    return removedImports;
  }

  private removeUnusedSpecifiers(params: {
    decl: ImportDeclaration;
    unusedSpecifiers: string[];
  }): void {
    const { decl, unusedSpecifiers } = params;

    // Remove unused default import
    const defaultImport = decl.getDefaultImport();
    if (defaultImport && unusedSpecifiers.includes(defaultImport.getText())) {
      decl.removeDefaultImport();
    }

    // Remove unused namespace import
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport && unusedSpecifiers.includes(`* as ${namespaceImport.getText()}`)) {
      decl.removeNamespaceImport();
    }

    // Remove unused named imports
    const namedImports = decl.getNamedImports();
    for (const namedImport of namedImports) {
      if (unusedSpecifiers.includes(namedImport.getName())) {
        namedImport.remove();
      }
    }
  }

  private buildSummary(params: {
    removedImports: RemovedImport[];
    dryRun: boolean;
    organized: boolean;
  }): string {
    const { removedImports, dryRun, organized } = params;
    const action = dryRun ? "Would remove" : "Removed";
    const totalSpecifiers = removedImports.reduce((sum, r) => sum + r.specifiers.length, 0);
    const fullDeclarations = removedImports.filter((r) => r.entireDeclaration).length;

    let summary = `${action} ${totalSpecifiers} unused import(s)`;
    if (fullDeclarations > 0) {
      summary += ` (${fullDeclarations} entire declaration(s))`;
    }
    if (organized && !dryRun) {
      summary += ", organized imports";
    }

    return summary;
  }
}
