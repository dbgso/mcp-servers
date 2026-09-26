/**
 * The query language's child navigation.
 *
 * A query nests: `{ kind: "CallExpression", expression: { kind: "..." } }`
 * descends from a node into a named child, and `getChildProperty` is the
 * switch that knows which accessor each name means for each node kind. It is
 * the largest block in the handler and almost none of its arms ran -- so a
 * query naming a child this server does not know about returns no matches,
 * which reads exactly like "nothing in your code matches".
 *
 * One fixture carries one of every shape, and each case here navigates into it
 * by a different arm.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { QueryAstHandler } from "../tools/handlers/query-ast.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "query-ast", "navigation.ts");
const handler = new QueryAstHandler();

type Match = { file: string; line: number; kind: string; text: string; captures?: Record<string, { text: string }> };

async function query(q: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const result = await handler.execute({ path: FIXTURE, query: q, ...extra });
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content as { text: string }[])[0].text) as {
    matches: Match[];
    totalMatches?: number;
    totalFiles: number;
  };
}

describe("descending into a named child", () => {
  it.each([
    {
      name: "expression, of an await",
      query: { kind: "AwaitExpression", expression: { kind: "CallExpression" } },
      expect: "readFile",
    },
    {
      name: "expression, of an as-cast",
      query: { kind: "AsExpression", expression: { kind: "Identifier", $text: "^input$" } },
      expect: "input as Shape",
    },
    {
      name: "expression, of a non-null assertion",
      query: { kind: "NonNullExpression", expression: { $any: true } },
      expect: "!",
    },
    {
      name: "expression, of a parenthesised expression",
      query: { kind: "ParenthesizedExpression", expression: { kind: "BinaryExpression" } },
      expect: "(count + 1)",
    },
    {
      name: "name, of a property access",
      query: { kind: "PropertyAccessExpression", name: { $text: "^render$" } },
      expect: "widget.render",
    },
    {
      name: "name, of a function declaration",
      query: { kind: "FunctionDeclaration", name: { $text: "^generic$" } },
      expect: "generic",
    },
    {
      name: "name, of a class declaration",
      query: { kind: "ClassDeclaration", name: { $text: "^Widget$" } },
      expect: "class Widget",
    },
    {
      name: "name, of a method declaration",
      query: { kind: "MethodDeclaration", name: { $text: "^render$" } },
      expect: "render()",
    },
    {
      name: "the operator of a binary expression",
      query: { kind: "BinaryExpression", operatorToken: { $text: "^\\+$" } },
      expect: "+",
    },
    {
      name: "the left side of a binary expression",
      query: { kind: "BinaryExpression", left: { kind: "Identifier", $text: "^count$" } },
      expect: "count",
    },
    {
      name: "the right side of a binary expression",
      query: { kind: "BinaryExpression", right: { kind: "NumericLiteral" } },
      expect: "1",
    },
    {
      name: "the type arguments of a call",
      query: { kind: "CallExpression", typeArguments: { $any: true } },
      expect: "generic<Shape>",
    },
    {
      name: "the module specifier of an import",
      query: { kind: "ImportDeclaration", moduleSpecifier: { $text: "node:fs" } },
      expect: "node:fs",
    },
    {
      name: "the module specifier of an export",
      query: { kind: "ExportDeclaration", moduleSpecifier: { $any: true } },
      expect: "export",
    },
    {
      name: "the import clause of an import",
      query: { kind: "ImportDeclaration", importClause: { $any: true } },
      expect: "import",
    },
    {
      name: "the named bindings of an import clause",
      query: { kind: "ImportClause", namedBindings: { $any: true } },
      expect: "readFile",
    },
    {
      name: "the condition of a ternary",
      query: { kind: "ConditionalExpression", condition: { kind: "BinaryExpression" } },
      expect: "?",
    },
    {
      name: "the condition of an if",
      query: { kind: "IfStatement", condition: { kind: "BinaryExpression" } },
      expect: "if (count > 0)",
    },
    {
      name: "the then branch of an if",
      query: { kind: "IfStatement", thenStatement: { kind: "Block" } },
      expect: "several",
    },
    {
      name: "the else branch of an if",
      query: { kind: "IfStatement", elseStatement: { kind: "Block" } },
      expect: "single",
    },
    {
      name: "the initializer of a variable",
      query: { kind: "VariableDeclaration", initializer: { kind: "NewExpression" } },
      expect: "new Widget()",
    },
    {
      name: "the initializer of a property",
      query: { kind: "PropertyDeclaration", initializer: { kind: "StringLiteral" } },
      expect: "widget",
    },
    {
      name: "the type of a variable",
      query: { kind: "VariableDeclaration", type: { kind: "TypeReference" } },
      expect: "Shape",
    },
    {
      name: "the type of a parameter",
      query: { kind: "Parameter", type: { kind: "NumberKeyword" } },
      expect: "count",
    },
    {
      name: "the return type of a function",
      query: { kind: "FunctionDeclaration", type: { kind: "TypeReference" } },
      expect: "Widget",
    },
    {
      name: "the type of an as-cast",
      query: { kind: "AsExpression", type: { kind: "TypeReference" } },
      expect: "as Shape",
    },
  ])("finds a match by $name", async ({ query: q, expect: expected }) => {
    const data = await query(q);

    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.map((m) => m.text).join("\n")).toContain(expected);
  });
});

describe("a child the node does not have", () => {
  it("matches nothing rather than erroring", async () => {
    // Asking for the `initializer` of a class is a mistake in the query, and
    // no match is the right answer -- but it is the same answer as "your code
    // has none", which is why the arms above matter.
    const data = await query({ kind: "ClassDeclaration", initializer: { $any: true } });

    expect(data.matches).toEqual([]);
  });

  it("matches nothing for a property name the switch has never heard of", async () => {
    const data = await query({ kind: "CallExpression", nonesuchProperty: { $any: true } });

    expect(data.matches).toEqual([]);
  });
});

describe("what comes back", () => {
  it("carries the captured nodes a query asked for", async () => {
    const data = await query({
      kind: "CallExpression",
      expression: { kind: "PropertyAccessExpression", name: { $capture: "method" } },
    });

    expect(data.matches[0].captures?.method?.text).toBeTruthy();
  });

  it.each([
    { output: "summary", check: (m: Match) => m.text === "" },
    { output: "compact", check: (m: Match) => !m.text.includes("\n") },
    { output: "full", check: (m: Match) => m.text.length > 0 },
  ])("is shaped by output: $output", async ({ output, check }) => {
    // `summary` is for counting, `compact` for scanning a list, `full` for
    // reading one. Returning the wrong one floods a tool response.
    const data = await query({ kind: "FunctionDeclaration" }, { output });

    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.every(check)).toBe(true);
  });

  it("stops at the limit it is given", async () => {
    const data = await query({ kind: "Identifier" }, { limit: 3 });

    expect(data.matches).toHaveLength(3);
  });
});

describe("what it refuses", () => {
  it("needs either a query or a preset", async () => {
    const result = await handler.execute({ path: FIXTURE });

    expect(result.isError).toBe(true);
  });

  it("reports a path with no matching files as an empty search", async () => {
    const result = await handler.execute({
      path: join(import.meta.dirname, "fixtures"),
      query: { kind: "FunctionDeclaration" },
      include: ["**/*.nonesuch"],
    });

    const data = JSON.parse((result.content as { text: string }[])[0].text);
    expect(data.totalFiles).toBe(0);
    expect(data.matches).toEqual([]);
  });
});
