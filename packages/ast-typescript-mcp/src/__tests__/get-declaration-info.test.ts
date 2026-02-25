import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { getDeclarationInfo } from "../handlers/typescript.js";

describe("getDeclarationInfo", () => {
  const project = new Project({ useInMemoryFileSystem: true });

  it("should return interface info for InterfaceDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "interface.ts",
      "export interface User { name: string; }",
      { overwrite: true }
    );
    const decl = sourceFile.getInterface("User")!;

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "User", kind: "interface" });
  });

  it("should return type info for TypeAliasDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "type.ts",
      "export type Status = 'active' | 'inactive';",
      { overwrite: true }
    );
    const decl = sourceFile.getTypeAlias("Status")!;

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "Status", kind: "type" });
  });

  it("should return class info for ClassDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "class.ts",
      "export class Handler { handle() {} }",
      { overwrite: true }
    );
    const decl = sourceFile.getClass("Handler")!;

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "Handler", kind: "class" });
  });

  it("should return 'anonymous' for class without name", () => {
    const sourceFile = project.createSourceFile(
      "anon-class.ts",
      "export default class { handle() {} }",
      { overwrite: true }
    );
    const decl = sourceFile.getClasses()[0];

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "anonymous", kind: "class" });
  });

  it("should return enum info for EnumDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "enum.ts",
      "export enum Color { Red, Green, Blue }",
      { overwrite: true }
    );
    const decl = sourceFile.getEnum("Color")!;

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "Color", kind: "enum" });
  });

  it("should return function info for FunctionDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "function.ts",
      "export function process() { return 1; }",
      { overwrite: true }
    );
    const decl = sourceFile.getFunction("process")!;

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "process", kind: "function" });
  });

  it("should return variable info for VariableDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "variable.ts",
      "export const MAX_SIZE = 100;",
      { overwrite: true }
    );
    const decl = sourceFile.getVariableDeclaration("MAX_SIZE")!;

    const result = getDeclarationInfo({ node: decl });

    expect(result).toEqual({ name: "MAX_SIZE", kind: "variable" });
  });

  it("should return method info for MethodDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "method.ts",
      "class Foo { bar() {} }",
      { overwrite: true }
    );
    const classDecl = sourceFile.getClass("Foo")!;
    const methodDecl = classDecl.getMethod("bar")!;

    const result = getDeclarationInfo({ node: methodDecl });

    expect(result).toEqual({ name: "bar", kind: "method" });
  });

  it("should return property info for PropertyDeclaration", () => {
    const sourceFile = project.createSourceFile(
      "property.ts",
      "class Foo { count: number = 0; }",
      { overwrite: true }
    );
    const classDecl = sourceFile.getClass("Foo")!;
    const propDecl = classDecl.getProperty("count")!;

    const result = getDeclarationInfo({ node: propDecl });

    expect(result).toEqual({ name: "count", kind: "property" });
  });

  it("should use fallbackName for unknown node types", () => {
    const sourceFile = project.createSourceFile(
      "import.ts",
      "import { foo } from 'bar';",
      { overwrite: true }
    );
    const importDecl = sourceFile.getImportDeclarations()[0];

    const result = getDeclarationInfo({ node: importDecl, fallbackName: "foo" });

    expect(result.name).toBe("foo");
    expect(result.kind).toBe("ImportDeclaration");
  });

  it("should return 'unknown' when no fallbackName provided", () => {
    const sourceFile = project.createSourceFile(
      "import2.ts",
      "import { foo } from 'bar';",
      { overwrite: true }
    );
    const importDecl = sourceFile.getImportDeclarations()[0];

    const result = getDeclarationInfo({ node: importDecl });

    expect(result.name).toBe("unknown");
    expect(result.kind).toBe("ImportDeclaration");
  });
});
