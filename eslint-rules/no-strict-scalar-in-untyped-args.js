/**
 * ESLint / oxlint rule: a boolean or number argument of a tool that publishes no
 * argument types must accept its string spelling.
 *
 * `instruction` advertises `additionalProperties: true` and nothing else --
 * `describe` is where its arguments are written down. A client then has no type
 * to serialise against, and Claude Code sent `recursive: true` as `"true"`. The
 * handler's strict `z.boolean()` rejected it, so `list(recursive: true)`, the
 * first call CLAUDE.md asks for, failed while being made exactly as documented.
 * Nothing caught it until someone made that call.
 *
 * Examples of INVALID code (in a file this rule is enabled for):
 *
 *   recursive: z.boolean().optional(),
 *   depth: z.number().int().min(1).optional(),
 *
 * Examples of VALID code:
 *
 *   recursive: looseBoolean(z.boolean().optional()),
 *   depth: looseNumber(z.number().int().min(1).optional()),
 *
 * The wrapper takes the whole chain, not just `z.boolean()`, so there is one
 * shape to write and one to check: the schema the handler declares is exactly
 * what runs after the conversion.
 *
 * Enabled only where the tool's input schema is untyped (`.oxlintrc.json`
 * overrides). A tool that publishes its types gets real booleans from the client
 * and should keep rejecting strings.
 */

const DEFAULT_WRAPPERS = { boolean: "looseBoolean", number: "looseNumber" };

/** `z.boolean()` / `z.number()`, and which of the two. */
function strictScalar(node) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || callee.object.name !== "z") return null;
  const name = callee.property.name;
  return name === "boolean" || name === "number" ? name : null;
}

/** Climb `z.boolean().optional().describe(...)` to the end of the chain. */
function chainEnd(node) {
  let current = node;
  for (;;) {
    const parent = current.parent;
    const continues =
      (parent?.type === "MemberExpression" && parent.object === current) ||
      (parent?.type === "CallExpression" && parent.callee === current);
    if (!continues) return current;
    current = parent;
  }
}

function isWrappedBy(params) {
  const { node, wrapper } = params;
  const parent = node.parent;
  if (parent?.type !== "CallExpression") return false;
  if (parent.callee.type !== "Identifier" || parent.callee.name !== wrapper) return false;
  return parent.arguments[0] === node;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Wrap z.boolean() / z.number() so a tool with untyped arguments accepts \"true\" and \"2\"",
    },
    schema: [
      {
        type: "object",
        properties: {
          wrappers: {
            type: "object",
            properties: {
              boolean: { type: "string" },
              number: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unwrapped:
        "This tool publishes no argument types, so a client may send this {{kind}} as a string. Wrap the whole chain: {{wrapper}}(z.{{kind}}()...).",
    },
  },

  create(context) {
    const wrappers = { ...DEFAULT_WRAPPERS, ...context.options?.[0]?.wrappers };

    return {
      CallExpression(node) {
        const kind = strictScalar(node);
        if (kind === null) return;

        const wrapper = wrappers[kind];
        if (isWrappedBy({ node: chainEnd(node), wrapper })) return;

        context.report({ node, messageId: "unwrapped", data: { kind, wrapper } });
      },
    };
  },
};
