/**
 * ESLint / oxlint rule: no Math.random outside tests.
 *
 * Carried over from dbgso/private-static-site. The random values a server here
 * needs are ones that must not be guessed: approval request ids that gate a
 * write, temp file names, nonces. Math.random is not a CSPRNG (V8 uses
 * xorshift128+) and its next outputs can be predicted from a few earlier
 * ones. Use `crypto.randomUUID()` / `crypto.randomBytes()` from node:crypto,
 * which costs nothing extra, so there is no case worth telling apart.
 *
 * Examples of INVALID code:
 *
 *   const id = Math.random().toString(36).slice(2);
 *
 * Examples of VALID code:
 *
 *   const id = randomUUID();
 */

const { dottedName, stripGlobalObject } = require("./utils.js");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Do not use Math.random (use crypto.randomUUID / randomBytes): random values here are ids and nonces, " +
        "and Math.random's outputs can be predicted.",
    },
    messages: {
      random: "Math.random is predictable. Use crypto.randomUUID() / crypto.randomBytes() from node:crypto.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = dottedName(node);
        if (name !== null && stripGlobalObject(name) === "Math.random") {
          context.report({ node, messageId: "random" });
        }
      },
    };
  },
};
