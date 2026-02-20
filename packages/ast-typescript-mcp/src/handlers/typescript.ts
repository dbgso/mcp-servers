import { Project, StructureKind } from "ts-morph";
import type { SourceFileStructure, StatementStructures } from "ts-morph";
import type {
  TsAstReadResult,
  TsQueryType,
  TsQueryResult,
  DeclarationSummary,
  ImportSummary,
  ExportSummary,
  DeclarationKind,
} from "../types/index.js";

export class TypeScriptHandler {
  readonly extensions = ["ts", "tsx", "mts", "cts"];
  readonly fileType = "typescript";

  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return this.extensions.includes(ext);
  }

  async read(filePath: string): Promise<TsAstReadResult> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const structure = sourceFile.getStructure();

    this.project.removeSourceFile(sourceFile);

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
    const sourceFile = this.project.addSourceFileAtPath(filePath);

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
      this.project.removeSourceFile(sourceFile);
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
    let sourceFile = this.project.getSourceFile(filePath);

    if (sourceFile) {
      sourceFile.set(structure);
    } else {
      sourceFile = this.project.createSourceFile(filePath, "", { overwrite: true });
      sourceFile.set(structure);
    }

    await sourceFile.save();
    this.project.removeSourceFile(sourceFile);
  }
}
