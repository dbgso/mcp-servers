/**
 * ESLint / oxlint rule: consecutive tests that differ only in values belong in
 * one `it.each`.
 *
 * Carried over from dbgso/private-static-site. A test copied and edited for
 * each value has its steps in N places: fixing the steps means fixing all N,
 * and missing one still passes, so nothing says it was missed. With `it.each`
 * the steps are written once and the cases read as a table.
 *
 * "Differ only in values" means the bodies have the same syntax and the same
 * names, and only literals (strings, numbers, regexes, template text) differ.
 * Bodies that call different functions or read different properties are
 * different steps, and are left alone. Tests generated in a `for` loop are
 * `vitest/prefer-each`'s job.
 *
 * Examples of INVALID code:
 *
 *   it("parses a", () => { expect(parse("a")).toBe(1); });
 *   it("parses b", () => { expect(parse("b")).toBe(2); });
 *
 * Examples of VALID code:
 *
 *   it.each([["a", 1], ["b", 2]])("parses %s", (input, want) => {
 *     expect(parse(input)).toBe(want);
 *   });
 */

const { dottedName } = require("./utils.js");

const TESTS = new Set(["it", "test", "it.concurrent", "test.concurrent"]);
const SKIP_KEYS = new Set(["parent", "range", "loc", "start", "end", "raw"]);

/** The shape of a body: literals keep their kind and drop their value. */
function shape(n) {
  if (Array.isArray(n)) return `[${n.map(shape).join(",")}]`;
  if (n === null || typeof n !== "object") return JSON.stringify(n);
  if (n.type === "Literal") return "L";
  if (n.type === "TemplateElement") return "Q";
  const keys = Object.keys(n).filter((k) => !SKIP_KEYS.has(k)).sort();
  return `{${keys.map((k) => `${k}:${shape(n[k])}`).join(",")}}`;
}

/** The callback, when the statement is `it("name", () => { ... })`. */
function testCallback(stmt) {
  if (stmt.type !== "ExpressionStatement") return null;
  const call = stmt.expression.type === "AwaitExpression" ? stmt.expression.argument : stmt.expression;
  if (call.type !== "CallExpression" || !TESTS.has(dottedName(call.callee) || "")) return null;
  const fn = call.arguments[call.arguments.length - 1];
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return null;
  return fn;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Consecutive tests whose bodies differ only in literals belong in one it.each / test.each: " +
        "a copied step fixed in one place and missed in another still passes.",
    },
    messages: {
      each: "This test differs from the one {{count}} lines above only in values. Fold them into it.each([...]).",
    },
    schema: [
      {
        type: "object",
        properties: {
          // Bodies shorter than this are not compared (rows of one-line asserts read fine as they are).
          minStatements: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const minStatements = (context.options[0] || {}).minStatements ?? 1;
    function check(body) {
      let prev = null;
      for (const stmt of body) {
        const fn = testCallback(stmt);
        if (!fn) {
          prev = null;
          continue;
        }
        const statements = fn.body.type === "BlockStatement" ? fn.body.body.length : 1;
        const s = statements >= minStatements ? shape({ params: fn.params, body: fn.body, async: fn.async }) : null;
        const line = stmt.loc ? stmt.loc.start.line : 0;
        if (s !== null && prev && prev.shape === s) {
          context.report({ node: stmt, messageId: "each", data: { count: String(line - prev.line) } });
        }
        prev = s === null ? null : { shape: s, line };
      }
    }
    return {
      Program(node) {
        check(node.body);
      },
      BlockStatement(node) {
        check(node.body);
      },
    };
  },
};
