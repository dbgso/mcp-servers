/**
 * ESLint / oxlint rule: do not pass secrets to a log.
 *
 * Carried over from dbgso/private-static-site, where the secrets are Lambda's.
 * Here they are what mcp-shared-secrets resolves (database passwords, API
 * tokens, connection strings with credentials in them) and what the CLIs read
 * from `--env-file`. An MCP server's stderr is kept by the client that launched
 * it (Claude Code writes it to its log files) and is pasted into issues when
 * something goes wrong, so a secret printed there has left the machine.
 *
 * So `console.*` and `process.stdout/stderr.write` refuse any argument whose
 * expression mentions a name that looks like a secret: a variable, a property
 * or an object key. Log a value built without the secret (`{ host, port }`),
 * or the name of the secret rather than its value.
 *
 * Examples of INVALID code:
 *
 *   console.error(`connecting with ${config.password}`);
 *   console.error({ token });
 *
 * Examples of VALID code:
 *
 *   console.error(`connecting to ${config.host}:${config.port}`);
 *   console.error(`secret ${secretRef.name} not found`);   // with an allowed name
 */

const { collectNames, dottedName, words } = require("./utils.js");

// Anywhere in the name: dbPassword, API_TOKEN, sessionCookie, connectionString...
const SECRET_PART =
  /secret|passw(?:or)?d|token|cookie|credential|authori[sz]ation|signature|private_?key|api_?key|connection_?string/i;
// As a whole word only: expectedSig, basic auth, a nonce (but not "design" or "basically").
const SECRET_WORD = new Set(["sig", "nonce", "basic", "hmac", "pwd", "dsn"]);
const SINK = /^(?:console\.\w+|process\.(?:stdout|stderr)\.write)$/;

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Do not pass values named like secrets (password, token, credential, connection string...) to " +
        "console.* or process.stdout/stderr.write: an MCP server's stderr is kept by the client and shared in bug reports.",
    },
    messages: {
      secret:
        "Do not log `{{name}}` ({{sink}}): an MCP server's stderr is kept by the client. Log a value built without the secret.",
    },
    schema: [
      {
        type: "object",
        properties: {
          // Names that match the pattern but are not secrets here (`tokenCount`, `TOKEN_ENV_NAME`).
          allowNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allow = new Set((context.options[0] || {}).allowNames || []);
    return {
      CallExpression(node) {
        const sink = dottedName(node.callee);
        if (sink === null || !SINK.test(sink)) return;
        for (const arg of node.arguments) {
          for (const { node: at, name } of collectNames(arg)) {
            if (allow.has(name)) continue;
            if (SECRET_PART.test(name) || words(name).some((w) => SECRET_WORD.has(w))) {
              context.report({ node: at, messageId: "secret", data: { sink, name } });
            }
          }
        }
      },
    };
  },
};
