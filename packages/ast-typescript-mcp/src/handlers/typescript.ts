import { Project, StructureKind, Node } from "ts-morph";
import type { SourceFileStructure, StatementStructures, ProjectOptions } from "ts-morph";
import type {
  TsAstReadResult,
  TsQueryType,
  TsQueryResult,
  DeclarationSummary,
  ImportSummary,
  ExportSummary,
  DeclarationKind,
  GoToDefinitionResult,
  DefinitionLocation,
  FindReferencesResult,
  ReferenceLocation,
} from "../types/index.js";
import { execSync } from "node:child_process";
import { dirname } from "node:path";
import type { Config, ExtendedOptions } from "../config.js";
import { findTsConfig, resolveToSourcePath } from "../config.js";

export class TypeScriptHandler {
  readonly extensions = ["ts", "tsx", "mts", "cts"];
  readonly fileType = "typescript";

  private projectOptions: ProjectOptions;
  private extendedOptions: ExtendedOptions;
  private projectCache: Map<string, Project> = new Map();

  constructor(config?: Config) {
    this.projectOptions = config?.projectOptions ?? {
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: false,
    };
    this.extendedOptions = config?.extendedOptions ?? {
      resolveToSource: true,
    };
  }

  /**
   * Get or create a Project for the given file.
   * Uses tsconfig auto-discovery if not explicitly set.
   */
  private getProjectForFile(filePath: string): Project {
    // If tsConfigFilePath is explicitly set, use a single project
    if (this.projectOptions.tsConfigFilePath) {
      const cacheKey = this.projectOptions.tsConfigFilePath;
      let project = this.projectCache.get(cacheKey);
      if (!project) {
        project = new Project(this.projectOptions);
        this.projectCache.set(cacheKey, project);
      }
      return project;
    }

    // Auto-discover tsconfig
    const tsConfigPath = findTsConfig(filePath);
    const cacheKey = tsConfigPath ?? "__no_tsconfig__";

    let project = this.projectCache.get(cacheKey);
    if (!project) {
      try {
        project = new Project({
          ...this.projectOptions,
          tsConfigFilePath: tsConfigPath,
        });
      } catch {
        // Fallback if tsconfig has errors
        project = new Project({
          skipAddingFilesFromTsConfig: true,
          skipFileDependencyResolution: true,
        });
      }
      this.projectCache.set(cacheKey, project);
    }
    return project;
  }

  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return this.extensions.includes(ext);
  }

  async read(filePath: string): Promise<TsAstReadResult> {
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);
    const structure = sourceFile.getStructure();

    project.removeSourceFile(sourceFile);

    return {
      filePath,
      fileType: "typescript",
      structure,
    };
  }

  async query(
    filePath: string,
    queryType: TsQueryType,
    options?: { name?: string; kind?: DeclarationKind }
  ): Promise<TsQueryResult> {
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);

    try {
      if (options?.name) {
        const structure = this.getByName(sourceFile.getStructure(), options.name);
        return {
          filePath,
          fileType: "typescript",
          query: "full",
          data: structure,
        };
      }

      switch (queryType) {
        case "summary":
          return {
            filePath,
            fileType: "typescript",
            query: "summary",
            data: this.getSummary(sourceFile, options?.kind),
          };
        case "imports":
          return {
            filePath,
            fileType: "typescript",
            query: "imports",
            data: this.getImports(sourceFile),
          };
        case "exports":
          return {
            filePath,
            fileType: "typescript",
            query: "exports",
            data: this.getExports(sourceFile),
          };
        default:
          return {
            filePath,
            fileType: "typescript",
            query: "full",
            data: sourceFile.getStructure(),
          };
      }
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  private getSummary(
    sourceFile: ReturnType<Project["addSourceFileAtPath"]>,
    kindFilter?: DeclarationKind
  ): DeclarationSummary[] {
    const summaries: DeclarationSummary[] = [];

    for (const cls of sourceFile.getClasses()) {
      if (!kindFilter || kindFilter === "class") {
        summaries.push({
          kind: "class",
          name: cls.getName() ?? "(anonymous)",
          exported: cls.isExported(),
          line: cls.getStartLineNumber(),
          members: cls.getMembers().length,
        });
      }
    }

    for (const fn of sourceFile.getFunctions()) {
      if (!kindFilter || kindFilter === "function") {
        summaries.push({
          kind: "function",
          name: fn.getName() ?? "(anonymous)",
          exported: fn.isExported(),
          line: fn.getStartLineNumber(),
        });
      }
    }

    for (const iface of sourceFile.getInterfaces()) {
      if (!kindFilter || kindFilter === "interface") {
        summaries.push({
          kind: "interface",
          name: iface.getName(),
          exported: iface.isExported(),
          line: iface.getStartLineNumber(),
          members: iface.getMembers().length,
        });
      }
    }

    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (!kindFilter || kindFilter === "type") {
        summaries.push({
          kind: "type",
          name: typeAlias.getName(),
          exported: typeAlias.isExported(),
          line: typeAlias.getStartLineNumber(),
        });
      }
    }

    for (const enumDecl of sourceFile.getEnums()) {
      if (!kindFilter || kindFilter === "enum") {
        summaries.push({
          kind: "enum",
          name: enumDecl.getName(),
          exported: enumDecl.isExported(),
          line: enumDecl.getStartLineNumber(),
          members: enumDecl.getMembers().length,
        });
      }
    }

    for (const varStmt of sourceFile.getVariableStatements()) {
      if (!kindFilter || kindFilter === "variable") {
        for (const decl of varStmt.getDeclarations()) {
          summaries.push({
            kind: "variable",
            name: decl.getName(),
            exported: varStmt.isExported(),
            line: decl.getStartLineNumber(),
          });
        }
      }
    }

    return summaries.sort((a, b) => a.line - b.line);
  }

  private getImports(sourceFile: ReturnType<Project["addSourceFileAtPath"]>): ImportSummary[] {
    return sourceFile.getImportDeclarations().map((imp) => {
      const namedImports = imp.getNamedImports().map((n) => n.getName());
      const defaultImport = imp.getDefaultImport()?.getText();
      const namespaceImport = imp.getNamespaceImport()?.getText();

      return {
        module: imp.getModuleSpecifierValue(),
        defaultImport,
        namedImports,
        namespaceImport,
        line: imp.getStartLineNumber(),
      };
    });
  }

  private getExports(sourceFile: ReturnType<Project["addSourceFileAtPath"]>): ExportSummary[] {
    const exports: ExportSummary[] = [];

    // Exported declarations
    for (const summary of this.getSummary(sourceFile)) {
      if (summary.exported) {
        exports.push({
          name: summary.name,
          kind: summary.kind,
          line: summary.line,
        });
      }
    }

    // Re-exports
    for (const exp of sourceFile.getExportDeclarations()) {
      const namedExports = exp.getNamedExports();
      for (const named of namedExports) {
        exports.push({
          name: named.getName(),
          kind: "reexport",
          line: exp.getStartLineNumber(),
        });
      }
    }

    return exports.sort((a, b) => a.line - b.line);
  }

  private getByName(structure: SourceFileStructure, name: string): StatementStructures | null {
    const statements = structure.statements;
    if (!statements || !Array.isArray(statements)) return null;

    for (const stmt of statements) {
      if (typeof stmt === "string" || typeof stmt === "function") continue;

      const s = stmt as StatementStructures;
      if ("name" in s && s.name === name) {
        return s;
      }

      // Check variable statements
      if (s.kind === StructureKind.VariableStatement) {
        const varStmt = s as { declarations?: Array<{ name?: string }> };
        if (varStmt.declarations?.some((d) => d.name === name)) {
          return s;
        }
      }
    }

    return null;
  }

  async write(filePath: string, structure: SourceFileStructure): Promise<void> {
    const project = this.getProjectForFile(filePath);
    let sourceFile = project.getSourceFile(filePath);

    if (sourceFile) {
      sourceFile.set(structure);
    } else {
      sourceFile = project.createSourceFile(filePath, "", { overwrite: true });
      sourceFile.set(structure);
    }

    await sourceFile.save();
    project.removeSourceFile(sourceFile);
  }

  async goToDefinition(
    filePath: string,
    line: number,
    column: number
  ): Promise<GoToDefinitionResult> {
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);
    const addedFiles: string[] = [filePath];

    try {
      // Convert line/column to position (ts-morph uses 0-based line internally)
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);

      // Find the node at position
      const node = sourceFile.getDescendantAtPos(pos);
      if (!node) {
        return {
          sourceFilePath: filePath,
          sourceLine: line,
          sourceColumn: column,
          identifier: "",
          definitions: [],
        };
      }

      const identifier = node.getText();
      const definitions: DefinitionLocation[] = [];

      // Check if it's an Identifier node which has getDefinitions()
      if (Node.isIdentifier(node)) {
        const defs = node.getDefinitions();

        for (const def of defs) {
          const defNode = def.getDeclarationNode();
          if (!defNode) continue;

          const defSourceFile = defNode.getSourceFile();
          const originalPath = defSourceFile.getFilePath();

          // Track if we added this file
          if (!addedFiles.includes(originalPath) && !project.getSourceFile(originalPath)) {
            addedFiles.push(originalPath);
          }

          const startLine = defNode.getStartLineNumber();
          const startCol = defNode.getStart() - defNode.getStartLinePos() + 1;

          // Get the kind of declaration
          const kind = def.getKind().toString();

          // Get the name
          const name = def.getName();

          // Get first line of definition text
          const fullText = defNode.getText();
          const firstLine = fullText.split("\n")[0].trim();
          let text = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine;

          // Resolve .d.ts to source .ts if enabled
          let finalPath: string = originalPath;
          if (this.extendedOptions.resolveToSource && originalPath.endsWith(".d.ts")) {
            const srcPath = resolveToSourcePath(originalPath);
            if (srcPath) {
              finalPath = srcPath;
              // Note: line numbers may differ in source file
              // For now, keep the same line (usually close enough)
              text = `${text} (resolved from .d.ts)`;
            }
          }

          definitions.push({
            filePath: finalPath,
            line: startLine,
            column: startCol,
            name,
            kind,
            text,
          });
        }
      }

      return {
        sourceFilePath: filePath,
        sourceLine: line,
        sourceColumn: column,
        identifier,
        definitions,
      };
    } finally {
      // Clean up all added files
      for (const fp of addedFiles) {
        const sf = project.getSourceFile(fp);
        if (sf) {
          project.removeSourceFile(sf);
        }
      }
    }
  }

  async findReferences(
    filePath: string,
    line: number,
    column: number
  ): Promise<FindReferencesResult> {
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);

    try {
      // Get the symbol at position
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
      const node = sourceFile.getDescendantAtPos(pos);

      if (!node || !Node.isIdentifier(node)) {
        return {
          definitionFilePath: filePath,
          definitionLine: line,
          definitionColumn: column,
          symbolName: "",
          references: [],
        };
      }

      const symbolName = node.getText();

      // Find git repository root
      const gitRoot = this.findGitRoot(filePath);
      if (!gitRoot) {
        return {
          definitionFilePath: filePath,
          definitionLine: line,
          definitionColumn: column,
          symbolName,
          references: [],
        };
      }

      // Use git grep to find candidate files
      const candidateFiles = this.gitGrep(gitRoot, symbolName);
      const references: ReferenceLocation[] = [];

      // Parse each candidate file and find actual references
      for (const candidatePath of candidateFiles) {
        if (candidatePath === filePath) continue; // Skip the definition file itself

        try {
          const refs = await this.findReferencesInFile(project, candidatePath, symbolName, filePath);
          references.push(...refs);
        } catch {
          // Skip files that can't be parsed
        }
      }

      return {
        definitionFilePath: filePath,
        definitionLine: line,
        definitionColumn: column,
        symbolName,
        references,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  private findGitRoot(filePath: string): string | null {
    try {
      const result = execSync("git rev-parse --show-toplevel", {
        cwd: dirname(filePath),
        encoding: "utf-8",
      });
      return result.trim();
    } catch {
      return null;
    }
  }

  private gitGrep(gitRoot: string, symbolName: string): string[] {
    try {
      // Search for the symbol in TypeScript files
      const result = execSync(
        `git grep -l --untracked "${symbolName}" -- "*.ts" "*.tsx" "*.mts" "*.cts" 2>/dev/null || true`,
        {
          cwd: gitRoot,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB
        }
      );

      return result
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((relativePath) => `${gitRoot}/${relativePath}`);
    } catch {
      return [];
    }
  }

  private async findReferencesInFile(
    project: Project,
    filePath: string,
    symbolName: string,
    definitionFilePath: string
  ): Promise<ReferenceLocation[]> {
    const references: ReferenceLocation[] = [];
    let sourceFile = project.getSourceFile(filePath);
    const needsCleanup = !sourceFile;

    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(filePath);
    }

    try {
      // Find all identifiers with the symbol name
      const identifiers = sourceFile.getDescendantsOfKind(
        Node.isIdentifier(sourceFile.getFirstDescendant(() => true)!)
          ? sourceFile.getFirstDescendant(() => true)!.getKind()
          : 80 // SyntaxKind.Identifier
      );

      for (const identifier of sourceFile.getDescendants()) {
        if (!Node.isIdentifier(identifier)) continue;
        if (identifier.getText() !== symbolName) continue;

        // Check if this identifier references the same definition
        try {
          const defs = identifier.getDefinitions();
          const matchesDefinition = defs.some(
            (def) => def.getSourceFile().getFilePath() === definitionFilePath
          );

          if (matchesDefinition) {
            const line = identifier.getStartLineNumber();
            const col = identifier.getStart() - identifier.getStartLinePos() + 1;

            // Determine context (import, call, type, etc.)
            const context = this.getReferenceContext(identifier);

            // Get the line text
            const lineText = sourceFile
              .getFullText()
              .split("\n")[line - 1]
              ?.trim();

            references.push({
              filePath,
              line,
              column: col,
              context,
              text: lineText?.slice(0, 100),
            });
          }
        } catch {
          // Skip identifiers that can't be resolved
        }
      }
    } finally {
      if (needsCleanup) {
        project.removeSourceFile(sourceFile);
      }
    }

    return references;
  }

  private getReferenceContext(node: Node): string {
    const parent = node.getParent();
    if (!parent) return "unknown";

    const parentKind = parent.getKindName();

    if (parentKind === "ImportSpecifier" || parentKind === "ImportClause") {
      return "import";
    }
    if (parentKind === "CallExpression") {
      return "call";
    }
    if (parentKind === "TypeReference") {
      return "type";
    }
    if (parentKind === "NewExpression") {
      return "new";
    }
    if (parentKind === "PropertyAccessExpression") {
      return "property";
    }
    if (parentKind === "ExportSpecifier") {
      return "export";
    }

    return parentKind.toLowerCase();
  }
}
