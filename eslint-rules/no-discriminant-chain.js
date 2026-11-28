/**
 * ESLint / oxlint rule: a chain of branches on one discriminator is a dispatch,
 * and a dispatch is a type or a table, not control flow.
 *
 * Criterion: `coding-rules__complexity` (what to do with each kind of branching)
 * and `coding-rules__polymorphism` (why). Found while sorting the 269
 * `complexity` warnings: the branches that hurt testability were mostly these.
 * `serializeBlock` switched on `block.context` across 12 arms, so no serializer
 * could be tested without building a whole document. And the same chain was
 * written twice in pdca, where one copy matched phase names production no longer
 * writes: `read_output` never printed a phase section, and its tests passed.
 *
 * Reported:
 *
 *   if (node.type === "a") { ... } else if (node.type === "b") { ... } else if (node.type === "c") { ... }
 *   switch (block.context) { case "quote": ...; case "sidebar": ...; case "example": ... }
 *
 * The message depends on what the arms do:
 *   - every arm only returns a literal -> it is a mapping: a `Record` constant
 *   - otherwise -> a `Record` keyed by the discriminator: data per kind when
 *     the arms differ only in values, a class per kind behind one interface
 *     when they differ in behaviour
 *
 * Not reported: chains shorter than `minArms`, chains whose arms test different
 * expressions (that is a guard sequence, see `coding-rules__early-return`).
 */

const COMPARISON = new Set(["===", "=="]);

function isLiteral(node) {
  return node.type === "Literal" || (node.type === "TemplateLiteral" && node.expressions.length === 0);
}

/** `x === "a"`, `"a" === x`, or `x === "a" || x === "b"` -> the text of `x`, else null. */
function discriminantOf(params) {
  const { node, text } = params;
  if (node.type === "LogicalExpression" && node.operator === "||") {
    const left = discriminantOf({ node: node.left, text });
    return left !== null && left === discriminantOf({ node: node.right, text }) ? left : null;
  }
  if (node.type !== "BinaryExpression" || !COMPARISON.has(node.operator)) return null;
  if (isLiteral(node.right)) return text(node.left);
  return isLiteral(node.left) ? text(node.right) : null;
}

/** The tests of `if / else if / else if ...`, starting at the head of the chain. */
function chainTests(head) {
  const tests = [];
  let current = head;
  while (current && current.type === "IfStatement") {
    tests.push(current.test);
    current = current.alternate;
  }
  return tests;
}

function isElseIf(node) {
  return node.parent?.type === "IfStatement" && node.parent.alternate === node;
}

/** The single statement of a block, or the statement itself. */
function onlyStatement(node) {
  if (node?.type !== "BlockStatement") return node;
  return node.body.length === 1 ? node.body[0] : null;
}

function returnsLiteral(statement) {
  return statement?.type === "ReturnStatement" && statement.argument !== null && isLiteral(statement.argument);
}

function ifArmsAreMapping(head) {
  const arms = [];
  let current = head;
  while (current && current.type === "IfStatement") {
    arms.push(current.consequent);
    current = current.alternate;
  }
  if (current) arms.push(current);
  return arms.every((arm) => returnsLiteral(onlyStatement(arm)));
}

function switchIsMapping(node) {
  return node.cases
    .filter((c) => c.consequent.length > 0)
    .every((c) => c.consequent.length === 1 && returnsLiteral(c.consequent[0]));
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Replace an if/else-if chain or switch on one discriminator with a Record lookup or polymorphism",
    },
    schema: [
      {
        type: "object",
        properties: { minArms: { type: "integer", minimum: 2 } },
        additionalProperties: false,
      },
    ],
    messages: {
      mapping:
        "{{arms}} branches on `{{discriminant}}` that each only return a value: this is a mapping. Make it a `Record` constant and look the value up -- one table to read and test instead of {{arms}} branches. See coding-rules__complexity.",
      dispatch:
        "{{arms}} branches on `{{discriminant}}`: this dispatches on a kind. Look the arm up in a `Record` keyed by `{{discriminant}}` instead -- a table of data when the arms differ only in values (flags, options), a class per kind behind one interface when they differ in behaviour. Each kind is then testable on its own and a missing one is a compile error. See coding-rules__complexity and coding-rules__polymorphism.",
    },
  },

  create(context) {
    const minArms = context.options?.[0]?.minArms ?? 3;
    const text = (node) => context.sourceCode.getText(node);

    function report(params) {
      const { node, discriminant, arms, mapping } = params;
      context.report({
        node,
        messageId: mapping ? "mapping" : "dispatch",
        data: { discriminant, arms: String(arms) },
      });
    }

    return {
      IfStatement(node) {
        if (isElseIf(node)) return;
        const tests = chainTests(node);
        if (tests.length < minArms) return;
        const keys = tests.map((test) => discriminantOf({ node: test, text }));
        if (keys[0] === null || keys.some((key) => key !== keys[0])) return;
        report({ node, discriminant: keys[0], arms: tests.length, mapping: ifArmsAreMapping(node) });
      },

      SwitchStatement(node) {
        const arms = node.cases.filter((c) => c.test !== null).length;
        if (arms < minArms) return;
        report({ node, discriminant: text(node.discriminant), arms, mapping: switchIsMapping(node) });
      },
    };
  },
};
