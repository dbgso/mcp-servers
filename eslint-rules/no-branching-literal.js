/**
 * ESLint / oxlint rule: keep the branches of a conditional out of the argument.
 *
 * A conditional whose branches are large literals reads as one expression and
 * is three things at once: the decision, and both of its outcomes. The reader
 * has to hold the condition in mind through twenty lines of object literal to
 * find out what the other branch was, and a diff touching one outcome shows up
 * in the middle of the other.
 *
 * Examples of INVALID code:
 *
 *   formatNextActions(
 *     isDraft
 *       ? [
 *           { action: "read_meta", description: "…", example: "…" },
 *           { action: "graph", description: "…", example: "…" },
 *         ]
 *       : [{ action: "list", description: "…", example: "…" }]
 *   );
 *
 * Examples of VALID code:
 *
 *   formatNextActions(nextActionsFor({ isDraft, id }));   // extracted
 *   const label = isDraft ? "draft" : "promoted";          // small branches
 *   items.push(...(empty ? [] : [row]));                   // one is trivial
 *
 * The threshold is lines, not nodes: what makes these hard to read is that the
 * branches do not fit on the screen together, and that is what a line count
 * measures.
 */

/** A literal big enough that inlining it hides the other branch. */
function branchSpan(node) {
  if (node === null || node === undefined) return 0;
  if (node.type !== "ObjectExpression" && node.type !== "ArrayExpression") return 0;
  if (node.loc === undefined || node.loc === null) return 0;
  return node.loc.end.line - node.loc.start.line + 1;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Extract a conditional whose branches are multi-line object or array literals",
    },
    schema: [
      {
        type: "object",
        properties: {
          maxLines: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLarge:
        "This conditional's {{side}} spans {{lines}} lines ({{max}} allowed inline). Give the decision a name: move it into a function that returns the value, and call that here.",
    },
  },

  create(context) {
    const maxLines = context.options?.[0]?.maxLines ?? 3;

    return {
      ConditionalExpression(node) {
        const sides = [
          { side: "consequent", lines: branchSpan(node.consequent) },
          { side: "alternate", lines: branchSpan(node.alternate) },
        ];

        // The biggest offender only: two reports on one expression say the same
        // thing twice, and the fix is the same edit.
        const worst = sides.reduce((a, b) => (b.lines > a.lines ? b : a));
        if (worst.lines <= maxLines) return;

        context.report({
          node,
          messageId: "tooLarge",
          data: { side: worst.side, lines: String(worst.lines), max: String(maxLines) },
        });
      },
    };
  },
};
