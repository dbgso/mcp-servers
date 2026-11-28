/**
 * ESLint / oxlint rule: a boolean chain that asks the same question of the same
 * value, once per candidate, is a set membership or an every/some -- name it.
 *
 * Criterion: `coding-rules__complexity`. Found while sorting the 269
 * `complexity` warnings: `update-handler` checked nine fields with
 * `a === undefined && b === undefined && ...`, and ast-file-mcp classified a URL
 * as external with `url.startsWith("http://") || url.startsWith("https://")` in
 * six places. Each chain adds one branch per candidate, and each copy is one
 * more place for the list of candidates to drift.
 *
 * Reported (three or more operands, by default):
 *
 *   kind === "a" || kind === "b" || kind === "c"        -> KINDS.has(kind)
 *   a === undefined && b === undefined && c === undefined -> FIELDS.every(...)
 *   url.startsWith("http://") || url.startsWith("https://") || ... -> a named predicate
 *
 * Not reported:
 *   - two operands: `x === null || x === undefined` reads fine and a Set for it
 *     would not;
 *   - a chain that is the whole of what a function returns, such as
 *     `isLoopbackHost`: it already has a name and is tested on its own, which
 *     is what this rule asks for.
 */

const COMPARISON = new Set(["===", "!==", "==", "!="]);

/** Flatten `a || b || c` (same operator) into [a, b, c]. */
function operands(params) {
  const { node, operator } = params;
  if (node.type === "LogicalExpression" && node.operator === operator) {
    return [...operands({ node: node.left, operator }), ...operands({ node: node.right, operator })];
  }
  return [node];
}

/**
 * What an operand compares or calls on, as text: `x` for `x === "a"`,
 * `undefined` for `a === undefined`, `url.startsWith` for `url.startsWith("h")`.
 * Two operands with the same shape key ask the same question.
 */
function shapeKeys(params) {
  const { node, text } = params;
  if (node.type === "BinaryExpression" && COMPARISON.has(node.operator)) {
    return [`${node.operator}:L:${text(node.left)}`, `${node.operator}:R:${text(node.right)}`];
  }
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    return [`call:${text(node.callee)}`];
  }
  return [];
}

/** `function f() { return <chain>; }` or `(x) => <chain>`: the chain is already a named predicate. */
function isWholeReturn(node) {
  const parent = node.parent;
  if (parent?.type === "ArrowFunctionExpression" && parent.body === node) return true;
  if (parent?.type !== "ReturnStatement") return false;
  const block = parent.parent;
  // The return sits directly in the function body, not inside a branch of it.
  return block?.type === "BlockStatement" && /Function/.test(block.parent?.type ?? "");
}

/** The shape key shared by every operand, or null. */
function sharedKey(params) {
  const { nodes, text } = params;
  const [first, ...rest] = nodes.map((node) => shapeKeys({ node, text }));
  return first.find((key) => rest.every((keys) => keys.includes(key))) ?? null;
}

function describe(key) {
  const [kind, , subject] = key.split(":");
  if (kind === "call") return `\`${key.slice(5)}(...)\``;
  return `\`${subject}\``;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Name a chain that asks the same question of one value as a set membership or every/some",
    },
    schema: [
      {
        type: "object",
        properties: { minOperands: { type: "integer", minimum: 2 } },
        additionalProperties: false,
      },
    ],
    messages: {
      repeated:
        "{{count}} operands of `{{operator}}` all test {{subject}}. Put the candidates in one named list (`Set#has`, `array.some/every`) behind a named predicate: one place to change the list, one branch instead of {{count}}, and a function to test. See coding-rules__complexity.",
    },
  },

  create(context) {
    const minOperands = context.options?.[0]?.minOperands ?? 3;
    const text = (node) => context.sourceCode.getText(node);

    return {
      LogicalExpression(node) {
        if (node.operator === "??") return;
        // Only the outermost link of a chain: its parent would report the same chain.
        if (node.parent?.type === "LogicalExpression" && node.parent.operator === node.operator) return;
        if (isWholeReturn(node)) return;
        const nodes = operands({ node, operator: node.operator });
        if (nodes.length < minOperands) return;
        const key = sharedKey({ nodes, text });
        if (key === null) return;
        context.report({
          node,
          messageId: "repeated",
          data: { count: String(nodes.length), operator: node.operator, subject: describe(key) },
        });
      },
    };
  },
};
