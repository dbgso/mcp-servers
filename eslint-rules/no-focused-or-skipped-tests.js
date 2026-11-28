/**
 * ESLint / oxlint rule: do not commit focused or skipped tests.
 *
 * Carried over from dbgso/private-static-site. `vitest/no-focused-tests` and
 * `vitest/no-disabled-tests` see `.only` / `.skip`, but not `{ skip: true }`
 * passed as an option or `ctx.skip()` inside a test. All of them end the same
 * way: a test that does not run, in a CI run that stays green. `.only`
 * additionally skips every other test in the file without saying so.
 *
 * `.skipIf` / `.runIf` are allowed with `allowConditional: true`. Here they
 * gate the tests that need the floci emulator, which CI starts for exactly
 * those packages (see scripts/ci-test-matrix.mjs), so the condition is what
 * makes them run where they can.
 *
 * Examples of INVALID code:
 *
 *   it.only("parses", ...);
 *   describe.skip("helpers", ...);
 *   it("parses", { skip: true }, ...);
 *   it("parses", (ctx) => { ctx.skip(); });
 *
 * Examples of VALID code:
 *
 *   describe.skipIf(!hasEmulator)("ssmSource", ...);   // with allowConditional
 *   it.each(rows)("parses $name", ...);
 */

const { dottedName } = require("./utils.js");

const FNS = new Set(["describe", "it", "test", "suite"]);
const MODIFIERS = new Set(["only", "skip", "todo"]);
const CONDITIONAL = new Set(["skipIf", "runIf"]);
const CHAIN_OK = new Set(["each", "for", "concurrent", "sequential"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Do not commit .only / .skip / .todo, the { only / skip / todo } option, or ctx.skip(): " +
        "a test that does not run leaves CI green.",
    },
    messages: {
      modifier: "Do not commit `{{name}}` (a test that does not run leaves CI green).",
      option: "Do not commit the test option `{{name}}` (a test that does not run leaves CI green).",
    },
    schema: [
      {
        type: "object",
        properties: { allowConditional: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allowConditional = Boolean((context.options[0] || {}).allowConditional);
    const banned = (p) => MODIFIERS.has(p) || (!allowConditional && CONDITIONAL.has(p));
    return {
      CallExpression(node) {
        // it.each([...])("x", ...) calls the result of it.each; name it by the inner call.
        const each = node.callee.type === "CallExpression";
        const name = dottedName(each ? node.callee.callee : node.callee);
        if (name === null) return;
        const parts = name.split(".");
        const last = parts[parts.length - 1];

        // describe.only(...) / it.skip(...) / it.skipIf(c)(...) / describe.concurrent.only(...)
        if (!each && parts.length >= 2 && FNS.has(parts[0]) && parts.slice(1).some(banned)) {
          context.report({ node: node.callee, messageId: "modifier", data: { name } });
          return;
        }
        // ctx.skip() / t.todo() from the test context, and nested t.test.only
        if (
          !each &&
          parts.length >= 2 &&
          !FNS.has(parts[0]) &&
          (last === "skip" || last === "todo" || (last === "only" && FNS.has(parts[parts.length - 2])))
        ) {
          context.report({ node: node.callee, messageId: "modifier", data: { name } });
          return;
        }
        // it("x", { skip: true }, fn) / it.each(xs)("x", { only: true }, fn)
        if (!FNS.has(parts[0]) || !parts.slice(1).every((p) => CHAIN_OK.has(p))) return;
        for (const arg of node.arguments) {
          if (arg.type !== "ObjectExpression") continue;
          for (const p of arg.properties) {
            if (p.type !== "Property" || p.computed || p.key.type !== "Identifier") continue;
            if (!MODIFIERS.has(p.key.name)) continue;
            if (p.value.type === "Literal" && p.value.value === false) continue;
            context.report({ node: p, messageId: "option", data: { name: p.key.name } });
          }
        }
      },
    };
  },
};
