import { Project, StructureKind, Node, SyntaxKind, DiagnosticCategory, TypeFormatFlags } from "ts-morph";
import type { SourceFileStructure, StatementStructures, ProjectOptions, SourceFile } from "ts-morph";
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
  CallGraphNode,
  CallGraphResult,
  CallNodeKind,
  TypeHierarchyNode,
  TypeHierarchyResult,
  TypeHierarchyDirection,
  TypeHierarchyNodeKind,
  TypeHierarchyRelation,
  RenameSymbolResult,
  RenameLocation,
  DeadCodeResult,
  DeadCodeSymbol,
  ExtractInterfaceResult,
  DependencyGraphParams,
  DependencyGraphResult,
  DependencyNode,
  DependencyEdge,
  DependencyCycle,
  DiffStructureParams,
  DiffStructureResult,
  QueryGraphParams,
  QueryGraphResult,
  TypeCheckResult,
  TypeCheckDiagnostic,
  DiagnosticSeverity,
  AutoImportResult,
  AddedImport,
  InlineTypeResult,
  ExtractCommonInterfaceParams,
  ExtractCommonInterfaceResult,
  CommonMember,
} from "../types/index.js";
import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { glob } from "glob";
import { dirname, join, resolve } from "node:path";
import type { Config, ExtendedOptions } from "../config.js";
import { findTsConfig, resolveToSourcePath } from "../config.js";
import { diffStructures, type DiffableItem } from "mcp-shared";
import { getQueryPresetRegistry, BaseQueryPresetHandler } from "./query-presets/index.js";
import {
  detectWorkspace,
  buildMonorepoGraph,
  getDependentPackages,
  findPackageForFile,
  parseAllPackages,
} from "../monorepo/index.js";

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
    { filePath, queryType, options }: { filePath: string; queryType: TsQueryType; options?: { name?: string; kind?: DeclarationKind } }
  ): Promise<TsQueryResult> {
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);

    try {
      if (options?.name) {
        const structure = this.getByName({ structure: sourceFile.getStructure(), name: options.name });
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
            data: this.getSummary({ sourceFile: sourceFile, kindFilter: options?.kind }),
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
    { sourceFile, kindFilter }: { sourceFile: ReturnType<Project["addSourceFileAtPath"]>; kindFilter?: DeclarationKind }
  ): DeclarationSummary[] {
    const summaries: DeclarationSummary[] = [];

    for (const cls of sourceFile.getClasses()) {
      if (!kindFilter || kindFilter === "class") {
        const methods = cls.getMethods().map(m => ({
          name: m.getName(),
          line: m.getStartLineNumber(),
          column: m.getStart() - sourceFile.compilerNode.getLineStarts()[m.getStartLineNumber() - 1] + 1,
          params: m.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText(),
            optional: p.isOptional(),
          })),
          signature: m.getText().split(")")[0] + ")",
        }));
        summaries.push({
          kind: "class",
          name: cls.getName() ?? "(anonymous)",
          exported: cls.isExported(),
          line: cls.getStartLineNumber(),
          members: cls.getMembers().length,
          methods,
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
          column: fn.getStart() - sourceFile.compilerNode.getLineStarts()[fn.getStartLineNumber() - 1] + 1,
          params: fn.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText(),
            optional: p.isOptional(),
          })),
          signature: fn.getText().split(")")[0] + ")",
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
    for (const summary of this.getSummary({ sourceFile: sourceFile })) {
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

  private getByName({ structure, name }: { structure: SourceFileStructure; name: string }): StatementStructures | null {
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

  async write({ filePath, structure }: { filePath: string; structure: SourceFileStructure }): Promise<void> {
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
    { filePath, line, column }: { filePath: string; line: number; column: number }
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
    { filePath, line, column, options }: { filePath: string; line: number; column: number; options?: { scopeToDependents?: boolean } }
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
      let candidateFiles = this.gitGrep({ gitRoot, symbolName });

      // If scope_to_dependents is enabled, filter to only dependent packages
      if (options?.scopeToDependents) {
        const scopedFiles = await this.filterToDependentPackages({
          targetFilePath: filePath,
          candidateFiles,
          gitRoot
        });
        if (scopedFiles) {
          candidateFiles = scopedFiles;
        }
      }

      const references: ReferenceLocation[] = [];

      // Parse each candidate file and find actual references
      for (const candidatePath of candidateFiles) {
        try {
          const refs = await this.findReferencesInFile({
            project,
            filePath: candidatePath,
            symbolName,
            definitionFilePath: filePath,
            skipPosition: candidatePath === filePath ? { line, column } : undefined
          });
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

  /**
   * Filter candidate files to only those in packages that depend on the target package.
   * Returns null if monorepo detection fails (fallback to all files).
   */
  private async filterToDependentPackages(
    { targetFilePath, candidateFiles, gitRoot }: { targetFilePath: string; candidateFiles: string[]; gitRoot: string }
  ): Promise<string[] | null> {
    // Detect workspace
    const workspace = await detectWorkspace(gitRoot);
    if (!workspace) {
      return null; // Not a monorepo, search all files
    }

    // Parse all packages
    const packages = parseAllPackages({ packageDirs: workspace.packageDirs, rootDir: workspace.rootDir });

    // Find which package the target file belongs to
    const targetPackage = findPackageForFile({ filePath: targetFilePath, packages });
    if (!targetPackage) {
      return null; // File not in any package, search all files
    }

    // Build dependency graph and get dependent packages
    const graph = buildMonorepoGraph(workspace);
    const dependentNames = getDependentPackages({ packageName: targetPackage.name, graph });

    // Include the target package itself
    const allowedPackages = new Set([targetPackage.name, ...dependentNames]);

    // Get package directories for allowed packages
    const allowedDirs = packages
      .filter((pkg) => allowedPackages.has(pkg.name))
      .map((pkg) => pkg.path);

    // Filter candidate files to those within allowed directories
    return candidateFiles.filter((file) =>
      allowedDirs.some((dir) => file.startsWith(dir + "/") || file === dir)
    );
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

  private gitGrep({ gitRoot, symbolName }: { gitRoot: string; symbolName: string }): string[] {
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
    { project, filePath, symbolName, definitionFilePath, skipPosition }: { project: Project; filePath: string; symbolName: string; definitionFilePath: string; skipPosition?: { line: number; column: number } }
  ): Promise<ReferenceLocation[]> {
    const references: ReferenceLocation[] = [];
    let sourceFile = project.getSourceFile(filePath);
    const needsCleanup = !sourceFile;

    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(filePath);
    }

    try {
      // Find all identifiers with the symbol name
      for (const identifier of sourceFile.getDescendants()) {
        if (!Node.isIdentifier(identifier)) continue;
        if (identifier.getText() !== symbolName) continue;

        // Check if this identifier references the same definition
        try {
          const defs = identifier.getDefinitions();
          const definitionPackage = this.getPackageName(definitionFilePath);
          const matchesDefinition = defs.some((def) => {
            const defPath = def.getSourceFile().getFilePath();
            // Exact match
            if (defPath === definitionFilePath) return true;
            // Same package match (for cross-file references via interfaces/inheritance)
            if (definitionPackage && this.getPackageName(defPath) === definitionPackage) {
              return true;
            }
            return false;
          });

          if (matchesDefinition) {
            const line = identifier.getStartLineNumber();
            const col = identifier.getStart() - identifier.getStartLinePos() + 1;

            // Skip the definition position itself
            if (skipPosition && line === skipPosition.line && col === skipPosition.column) {
              continue;
            }

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

  /**
   * Extract package name from a file path.
   * Returns the package directory name (e.g., "mcp-shared" from "/packages/mcp-shared/src/...").
   */
  private getPackageName(filePath: string): string | null {
    const match = filePath.match(/packages\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Get call graph starting from a symbol at the given position.
   * Traces outgoing calls recursively up to maxDepth.
   */
  async getCallGraph(params: {
    filePath: string;
    line: number;
    column: number;
    maxDepth?: number;
    includeExternal?: boolean;
  }): Promise<CallGraphResult> {
    const { filePath, line, column, maxDepth = 5, includeExternal = false } = params;
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);
    const visited = new Set<string>();
    let nodeCount = 0;
    let maxDepthReached = false;

    try {
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
      const node = sourceFile.getDescendantAtPos(pos);

      if (!node) {
        return {
          root: { name: "", filePath, line, kind: "function", calls: [] },
          nodeCount: 0,
          maxDepthReached: false,
        };
      }

      // Find the containing function/method/class
      const container = this.findCallableContainer(node);
      if (!container) {
        return {
          root: { name: node.getText(), filePath, line, kind: "function", calls: [] },
          nodeCount: 0,
          maxDepthReached: false,
        };
      }

      const rootNode = this.buildCallGraphNode({
        project,
        node: container,
        visited,
        depth: 0,
        maxDepth,
        includeExternal,
        onNode: () => nodeCount++,
        onMaxDepth: () => { maxDepthReached = true; },
      });

      return {
        root: rootNode,
        nodeCount,
        maxDepthReached,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  private findCallableContainer(node: Node): Node | null {
    let current: Node | undefined = node;
    while (current) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current) ||
        Node.isConstructorDeclaration(current) ||
        Node.isClassDeclaration(current)
      ) {
        return current;
      }
      current = current.getParent();
    }
    return null;
  }

  private buildCallGraphNode(params: {
    project: Project;
    node: Node;
    visited: Set<string>;
    depth: number;
    maxDepth: number;
    includeExternal: boolean;
    onNode: () => void;
    onMaxDepth: () => void;
  }): CallGraphNode {
    const { project, node, visited, depth, maxDepth, includeExternal, onNode, onMaxDepth } = params;

    const name = this.getNodeName(node);
    const filePath = node.getSourceFile().getFilePath();
    const line = node.getStartLineNumber();
    const kind = this.getNodeKind(node);
    const nodeKey = `${filePath}:${line}:${name}`;

    onNode();

    // Check for circular reference
    if (visited.has(nodeKey)) {
      return { name: `${name} (circular)`, filePath, line, kind, calls: [] };
    }
    visited.add(nodeKey);

    // Check max depth
    if (depth >= maxDepth) {
      onMaxDepth();
      return { name, filePath, line, kind, calls: [] };
    }

    const calls: CallGraphNode[] = [];

    // Get all call expressions within this node
    const callExpressions = node.getDescendantsOfKind(SyntaxKind.CallExpression);
    const newExpressions = node.getDescendantsOfKind(SyntaxKind.NewExpression);

    for (const callExpr of [...callExpressions, ...newExpressions]) {
      const calledNode = this.resolveCallTarget({ project, callExpr, includeExternal });
      if (calledNode) {
        const childNode = this.buildCallGraphNode({
          project,
          node: calledNode,
          visited: new Set(visited), // Clone to allow different paths
          depth: depth + 1,
          maxDepth,
          includeExternal,
          onNode,
          onMaxDepth,
        });
        // Avoid duplicate calls in the same function
        if (!calls.some(c => c.filePath === childNode.filePath && c.line === childNode.line)) {
          calls.push(childNode);
        }
      }
    }

    return { name, filePath, line, kind, calls };
  }

  private getNodeName(node: Node): string {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
      return node.getName() ?? "(anonymous)";
    }
    if (Node.isClassDeclaration(node)) {
      return node.getName() ?? "(anonymous class)";
    }
    if (Node.isConstructorDeclaration(node)) {
      const parent = node.getParent();
      if (Node.isClassDeclaration(parent)) {
        return `${parent.getName() ?? "Class"}.constructor`;
      }
      return "constructor";
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (Node.isPropertyAssignment(parent)) {
        return parent.getName();
      }
      return "(arrow)";
    }
    return "(unknown)";
  }

  private getNodeKind(node: Node): CallNodeKind {
    if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
      return "function";
    }
    if (Node.isMethodDeclaration(node)) {
      return "method";
    }
    if (Node.isClassDeclaration(node)) {
      return "class";
    }
    if (Node.isArrowFunction(node)) {
      return "arrow";
    }
    if (Node.isConstructorDeclaration(node)) {
      return "constructor";
    }
    return "function";
  }

  private resolveCallTarget({ callExpr, includeExternal }: { project: Project; callExpr: Node; includeExternal: boolean }): Node | null {
    try {
      let expr: Node | undefined;

      if (Node.isCallExpression(callExpr)) {
        expr = callExpr.getExpression();
      } else if (Node.isNewExpression(callExpr)) {
        expr = callExpr.getExpression();
      }

      if (!expr) return null;

      // Handle property access (obj.method())
      if (Node.isPropertyAccessExpression(expr)) {
        expr = expr.getNameNode();
      }

      if (!Node.isIdentifier(expr)) return null;

      const defs = expr.getDefinitions();
      if (defs.length === 0) return null;

      const def = defs[0];
      const defNode = def.getDeclarationNode();
      if (!defNode) return null;

      const defFilePath = defNode.getSourceFile().getFilePath();

      // Skip external (node_modules) if not included
      if (!includeExternal && defFilePath.includes("node_modules")) {
        return null;
      }

      // Return the function/method/class declaration
      return this.findCallableContainer(defNode) ?? defNode;
    } catch {
      return null;
    }
  }

  /**
   * Get type hierarchy for a class or interface at the given position.
   * Traces inheritance relationships (extends, implements) in the specified direction.
   */
  async getTypeHierarchy(params: {
    filePath: string;
    line: number;
    column: number;
    direction?: TypeHierarchyDirection;
    maxDepth?: number;
    includeExternal?: boolean;
  }): Promise<TypeHierarchyResult> {
    const {
      filePath,
      line,
      column,
      direction = "both",
      maxDepth = 10,
      includeExternal = false,
    } = params;

    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);
    const visited = new Set<string>();
    let nodeCount = 0;
    let maxDepthReached = false;

    try {
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
      const node = sourceFile.getDescendantAtPos(pos);

      // Find the containing class or interface declaration
      const typeDeclaration = this.findTypeDeclaration(node);
      if (!typeDeclaration) {
        return {
          root: {
            name: node?.getText() ?? "",
            filePath,
            line,
            kind: "class",
            children: [],
          },
          direction,
          nodeCount: 0,
          maxDepthReached: false,
        };
      }

      const rootNode = this.buildTypeHierarchyNode({
        project,
        node: typeDeclaration,
        visited,
        depth: 0,
        maxDepth,
        direction,
        includeExternal,
        onNode: () => nodeCount++,
        onMaxDepth: () => { maxDepthReached = true; },
      });

      return {
        root: rootNode,
        direction,
        nodeCount,
        maxDepthReached,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  /**
   * Find the class or interface declaration containing the given node.
   */
  private findTypeDeclaration(node: Node | undefined): Node | null {
    let current: Node | undefined = node;
    while (current) {
      if (Node.isClassDeclaration(current) || Node.isInterfaceDeclaration(current)) {
        return current;
      }
      current = current.getParent();
    }
    return null;
  }

  /**
   * Build a type hierarchy node recursively.
   */
  private buildTypeHierarchyNode(params: {
    project: Project;
    node: Node;
    visited: Set<string>;
    depth: number;
    maxDepth: number;
    direction: TypeHierarchyDirection;
    includeExternal: boolean;
    relation?: TypeHierarchyRelation;
    onNode: () => void;
    onMaxDepth: () => void;
  }): TypeHierarchyNode {
    const {
      project,
      node,
      visited,
      depth,
      maxDepth,
      direction,
      includeExternal,
      relation,
      onNode,
      onMaxDepth,
    } = params;

    const name = this.getTypeName(node);
    const nodePath = node.getSourceFile().getFilePath();
    const nodeLine = node.getStartLineNumber();
    const kind = this.getTypeKind(node);
    const isExternal = nodePath.includes("node_modules");
    const nodeKey = `${nodePath}:${nodeLine}:${name}`;

    onNode();

    // Circular reference detected
    if (visited.has(nodeKey)) {
      return {
        name: `${name} (circular)`,
        filePath: nodePath,
        line: nodeLine,
        kind,
        relation,
        isExternal,
        children: [],
      };
    }
    visited.add(nodeKey);

    // Max depth reached
    if (depth >= maxDepth) {
      onMaxDepth();
      return {
        name,
        filePath: nodePath,
        line: nodeLine,
        kind,
        relation,
        isExternal,
        children: [],
      };
    }

    const children: TypeHierarchyNode[] = [];

    // Get ancestors (what this type extends/implements)
    const shouldTraverseAncestors = direction === "ancestors" || direction === "both";
    if (shouldTraverseAncestors) {
      const ancestors = this.getTypeAncestors({ project: project, node: node, includeExternal: includeExternal });
      for (const { node: ancestorNode, relation: ancestorRelation } of ancestors) {
        const childNode = this.buildTypeHierarchyNode({
          project,
          node: ancestorNode,
          visited: new Set(visited),
          depth: depth + 1,
          maxDepth,
          direction: "ancestors", // Only go up when traversing ancestors
          includeExternal,
          relation: ancestorRelation,
          onNode,
          onMaxDepth,
        });
        children.push(childNode);
      }
    }

    // Get descendants (types that extend/implement this type)
    const shouldTraverseDescendants = direction === "descendants" || direction === "both";
    if (shouldTraverseDescendants) {
      const descendants = this.getTypeDescendants({ project: project, node: node, includeExternal: includeExternal });
      for (const { node: descendantNode, relation: descendantRelation } of descendants) {
        const childNode = this.buildTypeHierarchyNode({
          project,
          node: descendantNode,
          visited: new Set(visited),
          depth: depth + 1,
          maxDepth,
          direction: "descendants", // Only go down when traversing descendants
          includeExternal,
          relation: descendantRelation,
          onNode,
          onMaxDepth,
        });
        children.push(childNode);
      }
    }

    return {
      name,
      filePath: nodePath,
      line: nodeLine,
      kind,
      relation,
      isExternal,
      children,
    };
  }

  private getTypeName(node: Node): string {
    if (Node.isClassDeclaration(node)) {
      return node.getName() ?? "(anonymous class)";
    }
    if (Node.isInterfaceDeclaration(node)) {
      return node.getName();
    }
    return "(unknown)";
  }

  private getTypeKind(node: Node): TypeHierarchyNodeKind {
    if (Node.isClassDeclaration(node)) {
      return "class";
    }
    return "interface";
  }

  /**
   * Get ancestors (base classes and implemented interfaces) of a type.
   */
  private getTypeAncestors(
    { node, includeExternal }: { project: Project; node: Node; includeExternal: boolean }
  ): Array<{ node: Node; relation: TypeHierarchyRelation }> {
    const result: Array<{ node: Node; relation: TypeHierarchyRelation }> = [];

    if (Node.isClassDeclaration(node)) {
      // Get base class
      const baseClass = node.getBaseClass();
      if (baseClass) {
        const baseFilePath = baseClass.getSourceFile().getFilePath();
        // Include if external is allowed or if it's not in node_modules
        const isExternal = baseFilePath.includes("node_modules");
        if (includeExternal || !isExternal) {
          result.push({ node: baseClass, relation: "extends" });
        }
      }

      // Get implemented interfaces
      const implementsClauses = node.getImplements();
      for (const impl of implementsClauses) {
        try {
          const typeSymbol = impl.getType().getSymbol();
          if (!typeSymbol) continue;

          const declarations = typeSymbol.getDeclarations();
          for (const decl of declarations) {
            if (Node.isInterfaceDeclaration(decl)) {
              const declFilePath = decl.getSourceFile().getFilePath();
              const isExternal = declFilePath.includes("node_modules");
              if (includeExternal || !isExternal) {
                result.push({ node: decl, relation: "implements" });
              }
            }
          }
        } catch {
          // Skip if can't resolve
        }
      }
    }

    if (Node.isInterfaceDeclaration(node)) {
      // Get extended interfaces
      const extendsClauses = node.getExtends();
      for (const ext of extendsClauses) {
        try {
          const typeSymbol = ext.getType().getSymbol();
          if (!typeSymbol) continue;

          const declarations = typeSymbol.getDeclarations();
          for (const decl of declarations) {
            if (Node.isInterfaceDeclaration(decl)) {
              const declFilePath = decl.getSourceFile().getFilePath();
              const isExternal = declFilePath.includes("node_modules");
              if (includeExternal || !isExternal) {
                result.push({ node: decl, relation: "extends" });
              }
            }
          }
        } catch {
          // Skip if can't resolve
        }
      }
    }

    return result;
  }

  /**
   * Get descendants (derived classes and implementors) of a type.
   */
  private getTypeDescendants(
    { node, includeExternal }: { project: Project; node: Node; includeExternal: boolean }
  ): Array<{ node: Node; relation: TypeHierarchyRelation }> {
    const result: Array<{ node: Node; relation: TypeHierarchyRelation }> = [];

    if (Node.isClassDeclaration(node)) {
      // Get derived classes
      const derivedClasses = node.getDerivedClasses();
      for (const derived of derivedClasses) {
        const derivedFilePath = derived.getSourceFile().getFilePath();
        const isExternal = derivedFilePath.includes("node_modules");
        if (includeExternal || !isExternal) {
          result.push({ node: derived, relation: "derivedBy" });
        }
      }
    }

    if (Node.isInterfaceDeclaration(node)) {
      // Get implementations (classes that implement this interface)
      try {
        const implementations = node.getImplementations();
        for (const impl of implementations) {
          // getNode() returns the identifier; we need to get the containing class declaration
          const implIdentifier = impl.getNode();
          const implNode = this.findTypeDeclaration(implIdentifier);
          // Only include class declarations
          if (implNode && Node.isClassDeclaration(implNode)) {
            const implFilePath = implNode.getSourceFile().getFilePath();
            const isExternal = implFilePath.includes("node_modules");
            if (includeExternal || !isExternal) {
              result.push({ node: implNode, relation: "derivedBy" });
            }
          }
        }
      } catch {
        // getImplementations may fail if project doesn't have all files
      }

      // Note: ts-morph doesn't have a direct method to find interfaces that extend this interface
      // We would need to search through all interfaces in the project
      // For now, we skip this to avoid performance issues
    }

    return result;
  }

  /**
   * Extract an interface from a class declaration.
   * Uses ts-morph's extractInterface() to create an interface with public members.
   */
  async extractInterface(params: {
    filePath: string;
    className: string;
    interfaceName?: string;
  }): Promise<ExtractInterfaceResult> {
    const { filePath, className, interfaceName } = params;
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);

    try {
      // Find the class by name
      const classDecl = sourceFile.getClass(className);
      if (!classDecl) {
        throw new Error(`Class '${className}' not found in file '${filePath}'`);
      }

      // Generate interface name if not provided (default: I{ClassName})
      const generatedInterfaceName = interfaceName ?? `I${className}`;

      // Extract interface structure from the class
      const interfaceStructure = classDecl.extractInterface(generatedInterfaceName);

      return {
        filePath,
        className,
        interfaceName: generatedInterfaceName,
        interfaceStructure,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  /**
   * Compare structure of two TypeScript files.
   * Returns added, removed, and modified declarations.
   */
  async diffStructure(params: DiffStructureParams): Promise<DiffStructureResult> {
    const { filePathA, filePathB, level = "summary" } = params;

    // Get summaries for both files
    const resultA = await this.query({ filePath: filePathA, queryType: "summary" });
    const resultB = await this.query({ filePath: filePathB, queryType: "summary" });

    const summariesA = resultA.data as DeclarationSummary[];
    const summariesB = resultB.data as DeclarationSummary[];

    // Convert DeclarationSummary to DiffableItem
    const itemsA: DiffableItem[] = summariesA.map((s) => ({
      key: s.name,
      kind: s.kind,
      line: s.line,
      properties: level === "detailed" ? {
        exported: s.exported,
        members: s.members,
      } : undefined,
    }));

    const itemsB: DiffableItem[] = summariesB.map((s) => ({
      key: s.name,
      kind: s.kind,
      line: s.line,
      properties: level === "detailed" ? {
        exported: s.exported,
        members: s.members,
      } : undefined,
    }));

    // Perform diff
    const diffResult = diffStructures({ itemsA, itemsB, options: { level } });

    return {
      filePathA,
      filePathB,
      fileType: "typescript",
      added: diffResult.added,
      removed: diffResult.removed,
      modified: diffResult.modified,
      summary: diffResult.summary,
    };
  }

  /**
   * Analyze module dependencies in a directory and detect cycles using Tarjan's SCC algorithm.
   */
  async getDependencyGraph(params: DependencyGraphParams): Promise<DependencyGraphResult> {
    const { directory, pattern = "**/*.{ts,tsx,mts,cts}", includeExternal = false } = params;

    // Find all matching files using find command
    const files = this.findFilesWithPattern({ directory: directory, pattern: pattern });

    // Build adjacency list for all modules
    const adjacencyList = new Map<string, Set<string>>();
    const nodesMap = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];
    const project = this.getProjectForDirectory(directory);

    // Initialize nodes for all files
    for (const filePath of files) {
      nodesMap.set(filePath, { filePath, isExternal: false });
      adjacencyList.set(filePath, new Set());
    }

    // Analyze imports and re-exports for each file
    for (const filePath of files) {
      try {
        const sourceFile = project.addSourceFileAtPath(filePath);

        // Process regular imports
        const imports = this.getImports(sourceFile);
        for (const imp of imports) {
          this.addDependencyEdge({ fromFile: filePath, moduleSpecifier: imp.module, importInfo: {
            defaultImport: imp.defaultImport,
            namespaceImport: imp.namespaceImport,
            namedImports: imp.namedImports,
          }, includeExternal: includeExternal, nodesMap: nodesMap, adjacencyList: adjacencyList, edges: edges });
        }

        // Process re-exports (export { ... } from "...")
        for (const exp of sourceFile.getExportDeclarations()) {
          const moduleSpecifier = exp.getModuleSpecifierValue();
          if (!moduleSpecifier) continue; // Skip re-exports without module specifier

          const namedExports = exp.getNamedExports().map((n) => n.getName());
          this.addDependencyEdge({ fromFile: filePath, moduleSpecifier: moduleSpecifier, importInfo: {
            namedImports: namedExports,
          }, includeExternal: includeExternal, nodesMap: nodesMap, adjacencyList: adjacencyList, edges: edges });
        }

        project.removeSourceFile(sourceFile);
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Detect cycles using Tarjan's SCC algorithm
    const cycles = this.detectCyclesWithTarjan(adjacencyList);

    return {
      nodes: Array.from(nodesMap.values()),
      edges,
      cycles,
    };
  }

  /**
   * Add a dependency edge for an import or re-export.
   */
  private addDependencyEdge(
    { fromFile, moduleSpecifier, importInfo, includeExternal, nodesMap, adjacencyList, edges }: { fromFile: string; moduleSpecifier: string; importInfo: { defaultImport?: string; namespaceImport?: string; namedImports?: string[] }; includeExternal: boolean; nodesMap: Map<string, DependencyNode>; adjacencyList: Map<string, Set<string>>; edges: DependencyEdge[] }
  ): void {
    const resolvedPath = this.resolveImportPath({ fromFile: fromFile, moduleSpecifier: moduleSpecifier, includeExternal: includeExternal });
    if (!resolvedPath) return;

    const isExternal = resolvedPath.includes("node_modules");
    if (isExternal && !includeExternal) return;

    // Add to nodes map if not exists
    if (!nodesMap.has(resolvedPath)) {
      nodesMap.set(resolvedPath, { filePath: resolvedPath, isExternal });
      adjacencyList.set(resolvedPath, new Set());
    }

    // Add edge to adjacency list
    const adj = adjacencyList.get(fromFile);
    if (adj) {
      adj.add(resolvedPath);
    }

    // Build specifiers list
    const specifiers: string[] = [];
    if (importInfo.defaultImport) specifiers.push(importInfo.defaultImport);
    if (importInfo.namespaceImport) specifiers.push(`* as ${importInfo.namespaceImport}`);
    if (importInfo.namedImports) specifiers.push(...importInfo.namedImports);

    edges.push({
      from: fromFile,
      to: resolvedPath,
      specifiers,
    });
  }

  /**
   * Get or create a Project for the given directory (with auto-discovered tsconfig).
   */
  private getProjectForDirectory(directory: string): Project {
    // Try to find a tsconfig in the directory
    const tsConfigPath = findTsConfig(join(directory, "dummy.ts"));
    const cacheKey = tsConfigPath ?? `__dir_${directory}__`;

    let project = this.projectCache.get(cacheKey);
    if (!project) {
      try {
        project = new Project({
          ...this.projectOptions,
          tsConfigFilePath: tsConfigPath,
        });
      } catch {
        project = new Project({
          skipAddingFilesFromTsConfig: true,
          skipFileDependencyResolution: true,
        });
      }
      this.projectCache.set(cacheKey, project);
    }
    return project;
  }

  /**
   * Find files matching a glob-like pattern using find command.
   * Supports patterns like "**\/*.{ts,tsx,mts,cts}" or "**\/filename.ts"
   */
  private findFilesWithPattern({ directory, pattern }: { directory: string; pattern: string }): string[] {
    try {
      // Convert glob pattern to find command arguments
      // For the common case of **/*.{ts,tsx,mts,cts}, we use find with -name
      let findArgs: string;

      // Handle the default pattern case
      if (pattern === "**/*.{ts,tsx,mts,cts}" || pattern.includes("{ts,tsx,mts,cts}")) {
        findArgs = `find "${directory}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.mts" -o -name "*.cts" \\) ! -path "*/node_modules/*" ! -name "*.d.ts"`;
      } else {
        // For simpler patterns, extract the extension
        const extMatch = pattern.match(/\*\.(\w+)$/);
        // For specific file patterns like **/a.ts or **/foo.ts
        const fileNameMatch = pattern.match(/\*\*\/([^*]+\.\w+)$/);

        if (fileNameMatch) {
          // Match specific filename like "**/a.ts"
          findArgs = `find "${directory}" -type f -name "${fileNameMatch[1]}" ! -path "*/node_modules/*"`;
        } else if (extMatch) {
          findArgs = `find "${directory}" -type f -name "*.${extMatch[1]}" ! -path "*/node_modules/*" ! -name "*.d.ts"`;
        } else {
          // Fallback: find all TypeScript files
          findArgs = `find "${directory}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.mts" -o -name "*.cts" \\) ! -path "*/node_modules/*" ! -name "*.d.ts"`;
        }
      }

      const result = execSync(`${findArgs} 2>/dev/null || true`, {
        encoding: "utf-8",
      });

      return result
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Resolve an import module specifier to an absolute file path.
   */
  private resolveImportPath(
    { fromFile, moduleSpecifier, includeExternal }: { fromFile: string; moduleSpecifier: string; includeExternal: boolean }
  ): string | null {
    // Skip external modules if not resolving them
    if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("/")) {
      if (!includeExternal) return null;
      // For external modules, return the module name as-is
      // This is a simplified approach - full resolution would require looking at node_modules
      return `node_modules/${moduleSpecifier}`;
    }

    const fromDir = dirname(fromFile);
    const basePath = resolve(fromDir, moduleSpecifier);

    // Try different extensions
    const extensions = [".ts", ".tsx", ".mts", ".cts", "/index.ts", "/index.tsx"];
    for (const ext of extensions) {
      const fullPath = basePath.endsWith(ext) ? basePath : basePath.replace(/\.(js|mjs|cjs)$/, "") + ext;
      // Check if the file exists by attempting to resolve it
      const normalizedPath = fullPath.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts");
      if (this.fileExists(normalizedPath)) {
        return normalizedPath;
      }
    }

    // If basePath ends with .js, try replacing with .ts
    if (moduleSpecifier.endsWith(".js")) {
      const tsPath = basePath.replace(/\.js$/, ".ts");
      if (this.fileExists(tsPath)) return tsPath;
    }

    return null;
  }

  /**
   * Check if a file exists.
   */
  private fileExists(filePath: string): boolean {
    try {
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Detect cycles using Tarjan's Strongly Connected Components algorithm.
   * Returns cycles where each cycle has more than one node (self-loops are ignored).
   */
  private detectCyclesWithTarjan(adjacencyList: Map<string, Set<string>>): DependencyCycle[] {
    const cycles: DependencyCycle[] = [];
    let index = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];

    const strongConnect = (v: string): void => {
      // Set the depth index for v to the smallest unused index
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      // Consider successors of v
      const successors = adjacencyList.get(v) ?? new Set();
      for (const w of successors) {
        if (!indices.has(w)) {
          // Successor w has not yet been visited; recurse on it
          strongConnect(w);
          const vLow = lowlinks.get(v) ?? Infinity;
          const wLow = lowlinks.get(w) ?? Infinity;
          lowlinks.set(v, Math.min(vLow, wLow));
        } else if (onStack.has(w)) {
          // Successor w is in stack and hence in the current SCC
          const vLow = lowlinks.get(v) ?? Infinity;
          const wIdx = indices.get(w) ?? Infinity;
          lowlinks.set(v, Math.min(vLow, wIdx));
        }
      }

      // If v is a root node, pop the stack and generate an SCC
      if (lowlinks.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let w: string | undefined;
        do {
          w = stack.pop();
          if (!w) break;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);

        // Only report cycles with more than one node
        // or self-references (node imports itself)
        if (scc.length > 1) {
          // Reverse to get the natural order (from first to last in cycle)
          scc.reverse();
          cycles.push({ nodes: scc });
        } else if (scc.length === 1) {
          // Check for self-reference
          const node = scc[0];
          if (adjacencyList.get(node)?.has(node)) {
            cycles.push({ nodes: [node, node] });
          }
        }
      }
    };

    // Run Tarjan's algorithm on all nodes
    for (const v of adjacencyList.keys()) {
      if (!indices.has(v)) {
        strongConnect(v);
      }
    }

    return cycles;
  }

  /**
   * Rename a symbol at the given position across all files.
   * By default, runs in dry-run mode (no files modified).
   */
  async renameSymbol(params: {
    filePath: string;
    line: number;
    column: number;
    newName: string;
    dryRun?: boolean;
  }): Promise<RenameSymbolResult> {
    const { filePath, line, column, newName, dryRun = true } = params;
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);
    const addedFiles: Set<string> = new Set([filePath]);

    try {
      // Get the symbol at position
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
      const node = sourceFile.getDescendantAtPos(pos);

      // Node must exist and be an identifier
      if (!node || !Node.isIdentifier(node)) {
        return {
          oldName: "",
          newName,
          dryRun,
          locations: [],
          modifiedFiles: [],
          totalOccurrences: 0,
        };
      }

      const oldName = node.getText();

      // Same name check - no need to rename
      if (oldName === newName) {
        return {
          oldName,
          newName,
          dryRun,
          locations: [],
          modifiedFiles: [],
          totalOccurrences: 0,
        };
      }

      // Find git repository root to search for references
      const gitRoot = this.findGitRoot(filePath);
      if (!gitRoot) {
        // No git root - rename only in current file
        return this.renameInSingleFile({
          project,
          sourceFile,
          node,
          oldName,
          newName,
          dryRun,
        });
      }

      // Find all candidate files using git grep
      const candidateFiles = this.gitGrep({ gitRoot: gitRoot, symbolName: oldName });

      // Add all candidate files to the project
      for (const candidatePath of candidateFiles) {
        if (!addedFiles.has(candidatePath)) {
          try {
            project.addSourceFileAtPath(candidatePath);
            addedFiles.add(candidatePath);
          } catch {
            // Skip files that can't be added
          }
        }
      }

      // Collect all rename locations before performing the rename
      const locations = this.collectRenameLocations({ project: project, node: node, oldName: oldName, definitionFilePath: filePath });
      const modifiedFilesSet = new Set<string>();
      for (const loc of locations) {
        modifiedFilesSet.add(loc.filePath);
      }
      const modifiedFiles = Array.from(modifiedFilesSet);

      // Perform the rename if not in dry-run mode
      if (!dryRun) {
        node.rename(newName);
        project.saveSync();
      }

      return {
        oldName,
        newName,
        dryRun,
        locations,
        modifiedFiles,
        totalOccurrences: locations.length,
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

  /**
   * Rename symbol in a single file (fallback when git root is not available).
   */
  private renameInSingleFile(params: {
    project: Project;
    sourceFile: SourceFile;
    node: Node;
    oldName: string;
    newName: string;
    dryRun: boolean;
  }): RenameSymbolResult {
    const { project, sourceFile, node, oldName, newName, dryRun } = params;

    // Collect locations in this file only
    const locations: RenameLocation[] = [];
    const filePath = sourceFile.getFilePath();

    for (const identifier of sourceFile.getDescendants()) {
      if (!Node.isIdentifier(identifier)) continue;
      if (identifier.getText() !== oldName) continue;

      // Check if the identifier refers to the same symbol
      try {
        const defs = identifier.getDefinitions();
        const nodeDefs = (node as ReturnType<typeof sourceFile.getDescendantAtPos> & { getDefinitions?: () => unknown[] })?.getDefinitions?.() ?? [];

        // Match if they have the same definition
        const matchesDefinition = defs.some((def) =>
          nodeDefs.some((nodeDef: unknown) => {
            const d = def as { getSourceFile: () => { getFilePath: () => string }; getName?: () => string };
            const nd = nodeDef as { getSourceFile: () => { getFilePath: () => string }; getName?: () => string };
            return d.getSourceFile().getFilePath() === nd.getSourceFile().getFilePath() &&
                   d.getName?.() === nd.getName?.();
          })
        );

        if (matchesDefinition || identifier === node) {
          const identifierLine = identifier.getStartLineNumber();
          const col = identifier.getStart() - identifier.getStartLinePos() + 1;
          const context = this.getReferenceContext(identifier);

          locations.push({
            filePath,
            line: identifierLine,
            column: col,
            originalText: oldName,
            context,
          });
        }
      } catch {
        // Skip identifiers that can't be resolved
      }
    }

    // Perform the rename if not in dry-run mode
    if (!dryRun && Node.isIdentifier(node)) {
      node.rename(newName);
      project.saveSync();
    }

    return {
      oldName,
      newName,
      dryRun,
      locations,
      modifiedFiles: locations.length > 0 ? [filePath] : [],
      totalOccurrences: locations.length,
    };
  }

  /**
   * Collect all locations that will be affected by the rename.
   */
  private collectRenameLocations(
    { project, node, oldName, definitionFilePath }: { project: Project; node: Node; oldName: string; definitionFilePath: string }
  ): RenameLocation[] {
    const locations: RenameLocation[] = [];

    // Get definition info for matching
    let definitionInfo: { filePath: string; name: string } | null = null;
    if (Node.isIdentifier(node)) {
      try {
        const defs = node.getDefinitions();
        if (defs.length > 0) {
          definitionInfo = {
            filePath: defs[0].getSourceFile().getFilePath(),
            name: defs[0].getName(),
          };
        }
      } catch {
        // Use node position as fallback
      }
    }

    // Search through all source files in the project
    for (const sourceFile of project.getSourceFiles()) {
      const sfPath = sourceFile.getFilePath();

      // Skip files in node_modules
      if (sfPath.includes("node_modules")) continue;

      for (const identifier of sourceFile.getDescendants()) {
        if (!Node.isIdentifier(identifier)) continue;
        if (identifier.getText() !== oldName) continue;

        try {
          const defs = identifier.getDefinitions();
          const matchesDefinition = defs.some((def) => {
            // Match by file path and name if we have definition info
            if (definitionInfo) {
              return (
                def.getSourceFile().getFilePath() === definitionInfo.filePath &&
                def.getName() === definitionInfo.name
              );
            }
            // Fallback: match by definition file path
            return def.getSourceFile().getFilePath() === definitionFilePath;
          });

          if (matchesDefinition) {
            const identifierLine = identifier.getStartLineNumber();
            const col = identifier.getStart() - identifier.getStartLinePos() + 1;
            const context = this.getReferenceContext(identifier);

            locations.push({
              filePath: sfPath,
              line: identifierLine,
              column: col,
              originalText: oldName,
              context,
            });
          }
        } catch {
          // Skip identifiers that can't be resolved
        }
      }
    }

    return locations;
  }

  /**
   * Find dead code (unused exports and private members) in the given paths.
   * @param params.paths - Array of file or directory paths to analyze
   * @param params.includeTests - Whether to include test files (default: false)
   * @param params.entryPoints - Array of glob patterns for entry points (their exports are excluded)
   * @returns DeadCodeResult with unused symbols
   */
  async findDeadCode(params: {
    paths: string[];
    includeTests?: boolean;
    entryPoints?: string[];
  }): Promise<DeadCodeResult> {
    const { paths, includeTests = false, entryPoints = [] } = params;
    const deadSymbols: DeadCodeSymbol[] = [];
    let filesAnalyzed = 0;
    let exportsChecked = 0;
    let privateMembersChecked = 0;

    // Collect all TypeScript files from the given paths
    const allFiles = this.collectTypeScriptFiles(paths);

    // Filter out test files if not included
    const filesToAnalyze = includeTests
      ? allFiles
      : allFiles.filter((f) => !this.isTestFile(f));

    // Build a set of entry point patterns for exclusion
    const entryPointPatterns = entryPoints.map((ep) => {
      // Entry points should be treated as "used" exports
      return ep.replace(/\*/g, ".*");
    });

    // Process each file
    for (const filePath of filesToAnalyze) {
      filesAnalyzed++;
      const project = this.getProjectForFile(filePath);
      let sourceFile: SourceFile | undefined;

      try {
        sourceFile = project.addSourceFileAtPath(filePath);

        // Check unused exports
        const unusedExports = await this.findUnusedExports(
          { project: project, sourceFile: sourceFile, allFiles: filesToAnalyze, entryPointPatterns: entryPointPatterns }
        );
        exportsChecked += unusedExports.checked;
        deadSymbols.push(...unusedExports.dead);

        // Check unused private members
        const unusedPrivates = this.findUnusedPrivateMembers({ sourceFile: sourceFile, filePath: filePath });
        privateMembersChecked += unusedPrivates.checked;
        deadSymbols.push(...unusedPrivates.dead);
      } catch {
        // Skip files that can't be parsed
      } finally {
        if (sourceFile) {
          project.removeSourceFile(sourceFile);
        }
      }
    }

    return {
      deadSymbols,
      filesAnalyzed,
      exportsChecked,
      privateMembersChecked,
    };
  }

  /**
   * Collect all TypeScript files from the given paths.
   */
  private collectTypeScriptFiles(paths: string[]): string[] {
    const files: string[] = [];

    for (const path of paths) {
      try {
        // Check if path is a file or directory
        const result = execSync(`test -f "${path}" && echo "file" || echo "dir"`, {
          encoding: "utf-8",
        }).trim();

        if (result === "file") {
          // Single file - check if it's a TypeScript file
          if (this.canHandle(path)) {
            files.push(path);
          }
        } else {
          // Directory - use find to get all TypeScript files
          const findResult = execSync(
            `find "${path}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.mts" -o -name "*.cts" \\) ! -path "*/node_modules/*" 2>/dev/null || true`,
            { encoding: "utf-8" }
          );

          const dirFiles = findResult
            .trim()
            .split("\n")
            .filter((f) => f.length > 0);

          files.push(...dirFiles);
        }
      } catch {
        // Skip invalid paths
      }
    }

    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Check if a file is a test file.
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\.[tj]sx?$/,
      /\.spec\.[tj]sx?$/,
      /__tests__\//,
      /\/test\//,
      /\/tests\//,
    ];
    return testPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * Find unused exports in a source file.
   */
  private async findUnusedExports(
    { project, sourceFile, allFiles, entryPointPatterns }: { project: Project; sourceFile: SourceFile; allFiles: string[]; entryPointPatterns: string[] }
  ): Promise<{ dead: DeadCodeSymbol[]; checked: number }> {
    const dead: DeadCodeSymbol[] = [];
    const filePath = sourceFile.getFilePath();
    let checked = 0;

    // Check if this file is an entry point
    const isEntryPoint = entryPointPatterns.some((pattern) =>
      new RegExp(pattern).test(filePath)
    );

    // Get all exports from the file
    const exports = this.getExports(sourceFile);

    for (const exp of exports) {
      checked++;

      // Skip entry point exports - they are considered used
      if (isEntryPoint) {
        continue;
      }

      // Skip re-exports (they are handled differently)
      if (exp.kind === "reexport") {
        continue;
      }

      // Find references to this export in other files
      const hasExternalReference = await this.hasExternalReferences(
        { project: project, definitionFilePath: filePath, symbolName: exp.name, allFiles: allFiles }
      );

      if (!hasExternalReference) {
        dead.push({
          name: exp.name,
          filePath,
          line: exp.line,
          kind: "export",
          declarationKind: exp.kind as DeclarationKind,
        });
      }
    }

    return { dead, checked };
  }

  /**
   * Check if a symbol has references in other files.
   */
  private async hasExternalReferences(
    { project, definitionFilePath, symbolName, allFiles }: { project: Project; definitionFilePath: string; symbolName: string; allFiles: string[] }
  ): Promise<boolean> {
    // Use git grep for fast initial search
    const gitRoot = this.findGitRoot(definitionFilePath);
    if (!gitRoot) {
      return false;
    }

    const candidateFiles = this.gitGrep({ gitRoot: gitRoot, symbolName: symbolName });

    // Check each candidate file
    for (const candidatePath of candidateFiles) {
      // Skip the definition file itself
      if (candidatePath === definitionFilePath) {
        continue;
      }

      // Skip files not in our analysis scope
      if (!allFiles.includes(candidatePath)) {
        continue;
      }

      let sourceFile = project.getSourceFile(candidatePath);
      const needsCleanup = !sourceFile;

      try {
        if (!sourceFile) {
          sourceFile = project.addSourceFileAtPath(candidatePath);
        }

        // Check for imports of this symbol
        const imports = sourceFile.getImportDeclarations();
        for (const imp of imports) {
          // Check named imports
          const namedImports = imp.getNamedImports();
          for (const named of namedImports) {
            if (named.getName() === symbolName) {
              return true;
            }
            // Check aliased imports
            const alias = named.getAliasNode();
            if (alias && named.getName() === symbolName) {
              return true;
            }
          }

          // Check default import
          const defaultImport = imp.getDefaultImport();
          if (defaultImport && defaultImport.getText() === symbolName) {
            return true;
          }

          // Check namespace import with usage
          const namespaceImport = imp.getNamespaceImport();
          if (namespaceImport) {
            // Check if symbol is accessed via namespace
            const nsName = namespaceImport.getText();
            const accessPattern = `${nsName}.${symbolName}`;
            if (sourceFile.getFullText().includes(accessPattern)) {
              return true;
            }
          }
        }

        // Check re-exports
        const exportDecls = sourceFile.getExportDeclarations();
        for (const exp of exportDecls) {
          const namedExports = exp.getNamedExports();
          for (const named of namedExports) {
            if (named.getName() === symbolName) {
              return true;
            }
          }
        }
      } catch {
        // Skip files that can't be parsed
      } finally {
        if (needsCleanup && sourceFile) {
          project.removeSourceFile(sourceFile);
        }
      }
    }

    return false;
  }

  /**
   * Find unused private members in classes.
   */
  private findUnusedPrivateMembers(
    { sourceFile, filePath }: { sourceFile: SourceFile; filePath: string }
  ): { dead: DeadCodeSymbol[]; checked: number } {
    const dead: DeadCodeSymbol[] = [];
    let checked = 0;

    for (const cls of sourceFile.getClasses()) {
      // Collect all private members
      const privateMembers: Array<{
        name: string;
        line: number;
        kind: "method" | "property";
        node: Node;
      }> = [];

      // Private methods
      for (const method of cls.getMethods()) {
        if (method.hasModifier(SyntaxKind.PrivateKeyword)) {
          privateMembers.push({
            name: method.getName(),
            line: method.getStartLineNumber(),
            kind: "method",
            node: method,
          });
        }
      }

      // Private properties
      for (const prop of cls.getProperties()) {
        if (prop.hasModifier(SyntaxKind.PrivateKeyword)) {
          privateMembers.push({
            name: prop.getName(),
            line: prop.getStartLineNumber(),
            kind: "property",
            node: prop,
          });
        }
      }

      checked += privateMembers.length;

      // Check each private member for usage within the class
      for (const member of privateMembers) {
        const isUsed = this.isPrivateMemberUsed({ cls: cls, memberName: member.name, memberNode: member.node });

        if (!isUsed) {
          dead.push({
            name: member.name,
            filePath,
            line: member.line,
            kind: "private_member",
            declarationKind: member.kind,
          });
        }
      }
    }

    return { dead, checked };
  }

  /**
   * Check if a private member is used within its class.
   */
  private isPrivateMemberUsed({ cls, memberName, memberNode }: { cls: Node; memberName: string; memberNode: Node }): boolean {
    // Get all identifiers in the class
    for (const identifier of cls.getDescendantsOfKind(SyntaxKind.Identifier)) {
      // Skip the declaration itself
      if (identifier === memberNode || memberNode.containsRange(identifier.getPos(), identifier.getEnd())) {
        continue;
      }

      if (identifier.getText() !== memberName) {
        continue;
      }

      // Check if this is a reference (this.member)
      const parent = identifier.getParent();
      if (parent && Node.isPropertyAccessExpression(parent)) {
        const expr = parent.getExpression();
        // Check for this.memberName pattern
        if (expr.getKind() === SyntaxKind.ThisKeyword) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Query dependency_graph or call_graph results with jq or preset queries.
   * Uses polymorphic handlers for preset queries.
   */
  async queryGraph(params: QueryGraphParams): Promise<QueryGraphResult> {
    const { source, directory, jq: jqQuery, preset } = params;

    // Get the source data
    if (source !== "dependency") {
      throw new Error("call_graph source requires file_path, line, column - use dependency for directory-level queries");
    }
    const data = await this.getDependencyGraph({ directory });

    // Priority: jq > preset > raw stats
    if (jqQuery) {
      // Custom jq query - use inline handler
      const handler = new CustomJqHandler(jqQuery);
      const result = handler.execute({ data });
      return {
        source,
        query: jqQuery,
        result: result.result,
      };
    }

    if (preset) {
      // Use registry to get the appropriate handler
      const registry = getQueryPresetRegistry();
      const handler = registry.getHandler(preset);
      if (!handler) {
        throw new Error(`Unknown preset: ${preset}`);
      }
      const result = handler.execute({ data });
      return {
        source,
        query: preset,
        result: result.result,
      };
    }

    // Return raw data with basic stats
    return {
      source,
      query: "(none - raw stats)",
      result: {
        nodes: data.nodes.length,
        edges: data.edges.length,
        cycles: data.cycles.length,
      },
    };
  }

  /**
   * Type check a TypeScript file and return diagnostics.
   */
  async typeCheck(params: {
    filePath: string;
    includeSuggestions?: boolean;
  }): Promise<TypeCheckResult> {
    const { filePath, includeSuggestions = false } = params;
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);

    try {
      const diagnostics: TypeCheckDiagnostic[] = [];
      let errorCount = 0;
      let warningCount = 0;
      let suggestionCount = 0;

      // Get pre-emit diagnostics (errors and warnings) for all files, then filter
      const allDiagnostics = project.getPreEmitDiagnostics();
      const fileDiagnostics = allDiagnostics.filter(
        (d) => d.getSourceFile()?.getFilePath() === filePath
      );

      for (const diag of fileDiagnostics) {
        const diagnostic = this.convertDiagnostic(diag);
        diagnostics.push(diagnostic);

        if (diagnostic.severity === "error") errorCount++;
        else if (diagnostic.severity === "warning") warningCount++;
      }

      // Get suggestions if requested
      if (includeSuggestions) {
        const languageService = project.getLanguageService();
        const suggestions = languageService.getSuggestionDiagnostics(sourceFile);

        for (const diag of suggestions) {
          const diagnostic = this.convertSuggestionDiagnostic(diag);
          diagnostics.push(diagnostic);
          suggestionCount++;
        }
      }

      return {
        filePath,
        diagnostics,
        errorCount,
        warningCount,
        suggestionCount,
        success: errorCount === 0,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  /**
   * Convert ts-morph Diagnostic to TypeCheckDiagnostic.
   */
  private convertDiagnostic(
    diag: ReturnType<typeof Project.prototype.getPreEmitDiagnostics>[number]
  ): TypeCheckDiagnostic {
    const diagSourceFile = diag.getSourceFile();
    const start = diag.getStart();

    let line = 1;
    let column = 1;
    let diagFilePath = "";
    let sourceText: string | undefined;

    if (diagSourceFile && start !== undefined) {
      diagFilePath = diagSourceFile.getFilePath();
      const pos = diagSourceFile.getLineAndColumnAtPos(start);
      line = pos.line;
      column = pos.column;

      const length = diag.getLength() ?? 0;
      if (length > 0) {
        sourceText = diagSourceFile
          .getFullText()
          .slice(start, start + Math.min(length, 100));
      }
    }

    return {
      message: diag.getMessageText().toString(),
      severity: this.mapDiagnosticCategory(diag.getCategory()),
      code: diag.getCode(),
      filePath: diagFilePath,
      line,
      column,
      length: diag.getLength(),
      sourceText,
    };
  }

  /**
   * Convert ts-morph DiagnosticWithLocation (suggestions) to TypeCheckDiagnostic.
   */
  private convertSuggestionDiagnostic(
    diag: ReturnType<ReturnType<typeof Project.prototype.getLanguageService>["getSuggestionDiagnostics"]>[number]
  ): TypeCheckDiagnostic {
    const diagSourceFile = diag.getSourceFile();
    const start = diag.getStart();

    let line = 1;
    let column = 1;
    let diagFilePath = "";
    let sourceText: string | undefined;

    if (diagSourceFile) {
      diagFilePath = diagSourceFile.getFilePath();
      const pos = diagSourceFile.getLineAndColumnAtPos(start);
      line = pos.line;
      column = pos.column;

      const length = diag.getLength();
      if (length > 0) {
        sourceText = diagSourceFile
          .getFullText()
          .slice(start, start + Math.min(length, 100));
      }
    }

    return {
      message: diag.getMessageText().toString(),
      severity: "suggestion",
      code: diag.getCode(),
      filePath: diagFilePath,
      line,
      column,
      length: diag.getLength(),
      sourceText,
    };
  }

  private mapDiagnosticCategory(category: DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
      case DiagnosticCategory.Error:
        return "error";
      case DiagnosticCategory.Warning:
        return "warning";
      case DiagnosticCategory.Suggestion:
        return "suggestion";
      case DiagnosticCategory.Message:
        return "message";
      default:
        return "error";
    }
  }

  /**
   * Automatically add missing import statements.
   */
  async autoImport(params: {
    filePath: string;
    dryRun?: boolean;
  }): Promise<AutoImportResult> {
    const { filePath, dryRun = true } = params;
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);
    const warnings: string[] = [];

    try {
      // Get imports before
      const importsBefore = this.getImports(sourceFile);

      // Fix missing imports
      try {
        sourceFile.fixMissingImports();
      } catch (e) {
        // Known issue: empty named imports can cause errors
        warnings.push(`fixMissingImports warning: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Get imports after
      const importsAfter = this.getImports(sourceFile);

      // Calculate diff
      const addedImports = this.diffImports({ before: importsBefore, after: importsAfter });

      // Save only if not dry run
      if (!dryRun) {
        await sourceFile.save();
      }

      return {
        filePath,
        dryRun,
        addedImports,
        totalAdded: addedImports.length,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  /**
   * Calculate the difference between two import lists.
   */
  private diffImports(
    { before, after }: { before: ImportSummary[]; after: ImportSummary[] }
  ): AddedImport[] {
    const addedImports: AddedImport[] = [];

    for (const afterImp of after) {
      const beforeImp = before.find((b) => b.module === afterImp.module);

      if (!beforeImp) {
        // Completely new import
        addedImports.push({
          module: afterImp.module,
          defaultImport: afterImp.defaultImport,
          namedImports: afterImp.namedImports.length > 0 ? afterImp.namedImports : undefined,
          namespaceImport: afterImp.namespaceImport,
          isNew: true,
        });
      } else {
        // Check for newly added named imports
        const newNamedImports = afterImp.namedImports.filter(
          (n) => !beforeImp.namedImports.includes(n)
        );
        if (newNamedImports.length > 0) {
          addedImports.push({
            module: afterImp.module,
            namedImports: newNamedImports,
            isNew: false,
          });
        }
      }
    }

    return addedImports;
  }

  /**
   * Expand and inline the type at the given position.
   */
  async inlineType(params: {
    filePath: string;
    line: number;
    column: number;
  }): Promise<InlineTypeResult> {
    const { filePath, line, column } = params;
    const project = this.getProjectForFile(filePath);
    const sourceFile = project.addSourceFileAtPath(filePath);

    try {
      const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(
        line - 1,
        column - 1
      );
      const node = sourceFile.getDescendantAtPos(pos);

      if (!node) {
        return {
          filePath,
          line,
          column,
          identifier: "",
          originalType: "",
          expandedType: "",
          isExpanded: false,
        };
      }

      const identifier = node.getText();
      const type = node.getType();

      // Original type (may include alias name)
      const originalType = type.getText(node);

      // Expanded type (with InTypeAlias flag for full expansion)
      const expandedType = type.getText(
        node,
        TypeFormatFlags.InTypeAlias | TypeFormatFlags.NoTruncation
      );

      // Get alias information if available
      const aliasSymbol = type.getAliasSymbol();
      const aliasName = aliasSymbol?.getName();

      return {
        filePath,
        line,
        column,
        identifier,
        originalType,
        expandedType,
        aliasName,
        isExpanded: originalType !== expandedType,
      };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  }

  /**
   * Extract a common interface from multiple classes.
   * Analyzes classes to find shared methods/properties.
   */
  async extractCommonInterface(params: ExtractCommonInterfaceParams): Promise<ExtractCommonInterfaceResult> {
    const {
      sourceFiles,
      interfaceName,
      classPattern,
      includeMethods = true,
      includeProperties = true,
      minOccurrence = 0.5,
    } = params;

    const files = await this.resolveFiles(sourceFiles);
    const pattern = classPattern ? new RegExp(classPattern) : null;

    // Collect all members from all classes
    const memberMap = new Map<string, {
      kind: "method" | "property";
      type: string;
      classes: Set<string>;
    }>();
    const analyzedClasses: string[] = [];

    for (const filePath of files) {
      const project = this.getProjectForFile(filePath);
      const sourceFile = project.addSourceFileAtPath(filePath);

      try {
        for (const classDecl of sourceFile.getClasses()) {
          const className = classDecl.getName();
          if (!className) continue;
          if (pattern && !pattern.test(className)) continue;

          analyzedClasses.push(className);

          // Collect methods
          if (includeMethods) {
            for (const method of classDecl.getMethods()) {
              if (method.getScope() !== "public" && method.getScope() !== undefined) continue;
              const name = method.getName();
              const returnType = method.getReturnType().getText();
              const params = method.getParameters()
                .map((p) => `${p.getName()}: ${p.getType().getText()}`)
                .join(", ");
              const type = `(${params}) => ${returnType}`;

              const key = `method:${name}`;
              const existing = memberMap.get(key);
              if (existing) {
                existing.classes.add(className);
              } else {
                memberMap.set(key, {
                  kind: "method",
                  type,
                  classes: new Set([className]),
                });
              }
            }
          }

          // Collect properties
          if (includeProperties) {
            for (const prop of classDecl.getProperties()) {
              if (prop.getScope() !== "public" && prop.getScope() !== undefined) continue;
              const name = prop.getName();
              const type = prop.getType().getText();

              const key = `property:${name}`;
              const existing = memberMap.get(key);
              if (existing) {
                existing.classes.add(className);
              } else {
                memberMap.set(key, {
                  kind: "property",
                  type,
                  classes: new Set([className]),
                });
              }
            }
          }
        }
      } finally {
        project.removeSourceFile(sourceFile);
      }
    }

    // Filter members by occurrence threshold
    const threshold = Math.ceil(analyzedClasses.length * minOccurrence);
    const commonMembers: CommonMember[] = [];

    for (const [key, data] of memberMap) {
      if (data.classes.size >= threshold) {
        const [kind, name] = key.split(":") as ["method" | "property", string];
        commonMembers.push({
          name,
          kind,
          type: data.type,
          occurrences: data.classes.size,
          foundIn: Array.from(data.classes),
        });
      }
    }

    // Generate interface structure
    const interfaceStructure = {
      kind: StructureKind.Interface,
      name: interfaceName,
      isExported: true,
      methods: commonMembers
        .filter((m) => m.kind === "method")
        .map((m) => ({
          name: m.name,
          returnType: m.type.match(/=> (.+)$/)?.[1] ?? "void",
          parameters: this.parseMethodParams(m.type),
        })),
      properties: commonMembers
        .filter((m) => m.kind === "property")
        .map((m) => ({
          name: m.name,
          type: m.type,
        })),
    };

    return {
      interfaceName,
      analyzedClasses,
      commonMembers,
      interfaceStructure: interfaceStructure as import("ts-morph").InterfaceDeclarationStructure,
      totalClasses: analyzedClasses.length,
      totalCommonMembers: commonMembers.length,
    };
  }

  private parseMethodParams(typeString: string): Array<{ name: string; type: string }> {
    const match = typeString.match(/^\((.+)\) =>/);
    if (!match || !match[1]) return [];

    return match[1].split(",").map((p) => {
      const [name, type] = p.trim().split(":").map((s) => s.trim());
      return { name: name || "arg", type: type || "unknown" };
    });
  }

  /**
   * Resolve file paths from glob pattern or array.
   */
  private async resolveFiles(source: string | string[]): Promise<string[]> {
    const patterns = Array.isArray(source) ? source : [source];
    const allFiles: string[] = [];

    for (const pattern of patterns) {
      if (pattern.includes("*")) {
        const files = await glob(pattern, {
          ignore: ["**/node_modules/**", "**/dist/**"],
          absolute: true,
        });
        allFiles.push(...files);
      } else {
        allFiles.push(resolve(pattern));
      }
    }

    return [...new Set(allFiles)];
  }
}

/**
 * Handler for custom jq queries.
 * Extends BaseQueryPresetHandler to reuse jq execution logic.
 */
class CustomJqHandler extends BaseQueryPresetHandler {
  readonly preset = "top_referenced" as const; // Not used for custom queries
  private readonly jqQuery: string;

  constructor(jqQuery: string) {
    super();
    this.jqQuery = jqQuery;
  }

  getQuery(): string {
    return this.jqQuery;
  }
}
