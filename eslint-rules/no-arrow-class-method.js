/**
 * ESLint / oxlint rule: write a class's behaviour as methods, not as arrow
 * function properties.
 *
 * #88 turned object literals into classes and wrote the stateful ones as
 * arrow properties, so a method taken off its instance (`const { query } =
 * client`) kept `this` the way the old closure did. That made two ways to
 * write a method in one codebase, and a reader could not tell which one a
 * class was meant to use: `Mysql2IntrospectClient` used methods while its
 * twin `Mysql2QueryClient` used arrows, and it read as a defect.
 *
 * The hazard the arrows guarded against is checked directly instead:
 * `typescript/unbound-method` reports the line that takes a method off its
 * instance. So the class declares methods, and the call site is what lint
 * holds to account. Methods also live on the prototype, where
 * `vi.spyOn(Class.prototype, ...)` and `super.method()` can reach them.
 *
 * Examples of INVALID code:
 *
 *   class SsmSource implements SecretSource {
 *     fetch = async (path: string) => { ... };
 *   }
 *
 * Examples of VALID code:
 *
 *   class SsmSource implements SecretSource {
 *     async fetch(path: string) { ... }
 *   }
 *
 *   class Registry {
 *     readonly entries = new Map();            // data, not behaviour
 *   }
 */

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Declare class behaviour as methods instead of arrow function properties",
    },
    schema: [],
    messages: {
      arrowProperty:
        "`{{name}}` is a function-valued class property. Declare it as a method; `typescript/unbound-method` reports any call site that takes it off the instance.",
    },
  },

  create(context) {
    return {
      PropertyDefinition(node) {
        if (node.value === null || !FUNCTION_TYPES.has(node.value.type)) return;
        const name = node.key.type === "Identifier" ? node.key.name : "<computed>";
        context.report({ node, messageId: "arrowProperty", data: { name } });
      },
    };
  },
};
