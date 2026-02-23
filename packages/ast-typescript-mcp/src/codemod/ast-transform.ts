/**
 * AST-based transformations using ts-morph.
 * Unlike pattern-based codemod, this understands code structure.
 */

import { Project, SyntaxKind, StructureKind } from "ts-morph";
import type { ClassDeclaration, SourceFile } from "ts-morph";
import { glob } from "glob";
import { resolve, basename, dirname } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyMapping {
  /** Original property name */
  from: string;
  /** Target property name */
  to: string;
}

export interface MethodMapping {
  /** Original method name */
  from: string;
  /** Target property name (will be converted to arrow function) */
  to: string;
  /** Additional parameters to add (e.g., "ctx" for context) */
  addParams?: string[];
}

export interface ClassAdditions {
  /** Additional properties to add with their values */
  [key: string]: string | number | boolean | null;
}

export interface ClassToObjectOptions {
  /** File or glob pattern */
  files: string | string[];
  /** Regex pattern to match class names (default: ".*") */
  classPattern?: string;
  /** Property mappings (e.g., { from: "name", to: "id" }) */
  propertyMappings?: PropertyMapping[];
  /** Method mappings (e.g., { from: "doExecute", to: "execute" }) */
  methodMappings?: MethodMapping[];
  /** Properties to remove from output */
  removeProperties?: string[];
  /** Per-class additions (keyed by class name) */
  additions?: Record<string, ClassAdditions>;
  /** Type for the resulting object (e.g., "TsOperation<Args>") */
  targetType?: string;
  /** Dry run - don't modify files */
  dryRun?: boolean;
}

export interface TransformedClass {
  /** Original file path */
  filePath: string;
  /** Original class name */
  className: string;
  /** New variable name */
  variableName: string;
  /** Generated code */
  code: string;
}

export interface ClassToObjectResult {
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Successfully transformed classes */
  transformed: TransformedClass[];
  /** Files that were modified */
  filesModified: string[];
  /** Errors encountered */
  errors: Array<{ filePath: string; className?: string; error: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toVariableName(className: string): string {
  // GoToDefinitionHandler -> goToDefinitionOp
  // TsStructureReadHandler -> tsStructureReadOp
  const withoutHandler = className.replace(/Handler$/, "");
  const camelCase = withoutHandler.charAt(0).toLowerCase() + withoutHandler.slice(1);
  return camelCase + "Op";
}

function extractPropertyValue({ cls, propName }: { cls: ClassDeclaration; propName: string }): string | undefined {
  const prop = cls.getProperty(propName);
  if (!prop) return undefined;

  const initializer = prop.getInitializer();
  if (!initializer) return undefined;

  return initializer.getText();
}

function extractMethodBody({ cls, methodName }: { cls: ClassDeclaration; methodName: string }): string | undefined {
  const method = cls.getMethod(methodName);
  if (!method) return undefined;

  const body = method.getBody();
  if (!body) return undefined;

  // Get the body text without the outer braces
  const bodyText = body.getText();
  // Remove outer { } and trim
  return bodyText.slice(1, -1).trim();
}

function getMethodParams({ cls, methodName }: { cls: ClassDeclaration; methodName: string }): string[] {
  const method = cls.getMethod(methodName);
  if (!method) return [];

  return method.getParameters().map(p => {
    const name = p.getName();
    const type = p.getType().getText();
    return `${name}: ${type}`;
  });
}

function isMethodAsync({ cls, methodName }: { cls: ClassDeclaration; methodName: string }): boolean {
  const method = cls.getMethod(methodName);
  return method?.isAsync() ?? false;
}

function getMethodReturnType({ cls, methodName }: { cls: ClassDeclaration; methodName: string }): string | undefined {
  const method = cls.getMethod(methodName);
  if (!method) return undefined;

  const returnType = method.getReturnType();
  return returnType.getText();
}

// ─── Main Transform ──────────────────────────────────────────────────────────

export async function classToObject(options: ClassToObjectOptions): Promise<ClassToObjectResult> {
  const {
    files,
    classPattern = ".*",
    propertyMappings = [],
    methodMappings = [],
    removeProperties = [],
    additions = {},
    targetType,
    dryRun = true,
  } = options;

  const result: ClassToObjectResult = {
    dryRun,
    transformed: [],
    filesModified: [],
    errors: [],
  };

  // Resolve file paths
  const fileList = Array.isArray(files) ? files : [files];
  const resolvedFiles: string[] = [];

  for (const pattern of fileList) {
    if (pattern.includes("*")) {
      const matches = await glob(pattern, { absolute: true });
      resolvedFiles.push(...matches);
    } else {
      resolvedFiles.push(resolve(pattern));
    }
  }

  const classRegex = new RegExp(classPattern);
  const project = new Project();

  for (const filePath of resolvedFiles) {
    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      const classes = sourceFile.getClasses();

      for (const cls of classes) {
        const className = cls.getName();
        if (!className || !classRegex.test(className)) continue;

        try {
          const transformed = transformClass({ cls: cls, options: {
            propertyMappings,
            methodMappings,
            removeProperties,
            additions: additions[className] || {},
            targetType,
          } });

          result.transformed.push({
            filePath,
            className,
            variableName: transformed.variableName,
            code: transformed.code,
          });

          if (!dryRun) {
            // Replace the class with the object
            const classStart = cls.getStart();
            const classEnd = cls.getEnd();

            // Get leading trivia (comments, whitespace)
            const fullStart = cls.getFullStart();
            const leadingTrivia = sourceFile.getFullText().slice(fullStart, classStart);

            // Replace
            sourceFile.replaceText([fullStart, classEnd], leadingTrivia + transformed.code);

            if (!result.filesModified.includes(filePath)) {
              result.filesModified.push(filePath);
            }
          }
        } catch (error) {
          result.errors.push({
            filePath,
            className,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!dryRun && result.filesModified.includes(filePath)) {
        await sourceFile.save();
      }
    } catch (error) {
      result.errors.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

interface TransformClassOptions {
  propertyMappings: PropertyMapping[];
  methodMappings: MethodMapping[];
  removeProperties: string[];
  additions: ClassAdditions;
  targetType?: string;
}

interface TransformClassResult {
  variableName: string;
  code: string;
}

function transformClass({ cls, options }: { cls: ClassDeclaration; options: TransformClassOptions }): TransformClassResult {
  const className = cls.getName()!;
  const variableName = toVariableName(className);

  // Get the type parameter from extends clause (e.g., BaseToolHandler<Args> -> Args)
  const extendsClause = cls.getExtends();
  let typeArg = "";
  if (extendsClause) {
    const typeArgs = extendsClause.getTypeArguments();
    if (typeArgs.length > 0) {
      typeArg = typeArgs[0].getText();
    }
  }

  // Build object properties
  const objectProps: string[] = [];

  // Process existing properties with mappings
  const properties = cls.getProperties();
  const processedProps = new Set<string>();

  for (const prop of properties) {
    const propName = prop.getName();
    if (options.removeProperties.includes(propName)) continue;

    // Check for mapping
    const mapping = options.propertyMappings.find(m => m.from === propName);
    const targetName = mapping ? mapping.to : propName;

    const value = prop.getInitializer()?.getText();
    if (value) {
      objectProps.push(`  ${targetName}: ${value},`);
      processedProps.add(propName);
    }
  }

  // Add additions
  for (const [key, value] of Object.entries(options.additions)) {
    const formattedValue = typeof value === "string" ? `"${value}"` : String(value);
    objectProps.push(`  ${key}: ${formattedValue},`);
  }

  // Process methods with mappings
  for (const mapping of options.methodMappings) {
    const method = cls.getMethod(mapping.from);
    if (!method) continue;

    const isAsync = method.isAsync();
    const params = method.getParameters().map(p => {
      const name = p.getName();
      const typeNode = p.getTypeNode();
      const type = typeNode ? typeNode.getText() : p.getType().getText();
      return `${name}: ${type}`;
    });

    // Add additional params
    if (mapping.addParams) {
      params.push(...mapping.addParams);
    }

    const returnType = method.getReturnTypeNode()?.getText() || method.getReturnType().getText();
    const body = method.getBody();
    const bodyText = body ? body.getText() : "{}";

    const asyncPrefix = isAsync ? "async " : "";
    objectProps.push(`  ${mapping.to}: ${asyncPrefix}(${params.join(", ")}): ${returnType} => ${bodyText},`);
  }

  // Build the type annotation
  let typeAnnotation = "";
  if (options.targetType) {
    // Replace placeholder with actual type arg
    typeAnnotation = `: ${options.targetType.replace("<Args>", `<${typeArg}>`)}`;
  }

  // Build final code
  const code = `export const ${variableName}${typeAnnotation} = {
${objectProps.join("\n")}
};`;

  return { variableName, code };
}
