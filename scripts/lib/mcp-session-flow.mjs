/**
 * The parts of a session run that are decisions rather than I/O.
 *
 * Kept apart from `mcp-session.mjs` so they can be tested without spawning a
 * server: what a flow file means, what a template expands to, and whether a
 * response met what the step said it would. The runner does the spawning and
 * the printing.
 */

/**
 * One step of a flow file.
 *
 * A flow is JSON Lines rather than a JSON array so that a step can be added,
 * commented out or diffed a line at a time -- these files are read in review
 * as the record of what was exercised, not only executed.
 */
export function parseFlow(text) {
  const steps = [];
  const errors = [];
  let server = null;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    // Blank lines and `#` comments carry the structure a reader needs: which
    // calls belong to which part of the flow, and why a step is there.
    if (raw === "" || raw.startsWith("#")) continue;

    const at = i + 1;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push({ line: at, message: `not JSON: ${error.message}` });
      continue;
    }

    // `{"server": {...}}` is not a step: it says how to start the server this
    // flow is written against. Declared in the file rather than passed on the
    // command line so that running a flow does not depend on remembering one --
    // and so a test can run every flow in a directory without a mapping.
    if (isServerDirective(parsed)) {
      if (server !== null) errors.push({ line: at, message: "more than one `server` line" });
      else {
        const declared = toServer({ parsed, at });
        if (declared.error !== undefined) errors.push({ line: at, message: declared.error });
        else server = declared.server;
      }
      continue;
    }

    const step = toStep({ parsed, at });
    if (step.error !== undefined) errors.push({ line: at, message: step.error });
    else steps.push(step.step);
  }

  return { steps, server, errors };
}

function isServerDirective(parsed) {
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "server" in parsed;
}

function toServer(params) {
  const declared = params.parsed.server;

  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    return { error: "`server` must be a JSON object" };
  }

  const args = declared.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return { error: "`server.args` must be a list of strings" };
  }

  const env = declared.env ?? {};
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    return { error: "`server.env` must be a JSON object" };
  }
  if (Object.values(env).some((value) => typeof value !== "string")) {
    return { error: "`server.env` values must be strings" };
  }

  return { server: { args, env } };
}

function toStep(params) {
  const { parsed, at } = params;

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "a step must be a JSON object" };
  }

  if (parsed.tools === true) {
    return { step: { kind: "tools", line: at, label: parsed.label ?? "list tools" } };
  }

  if (typeof parsed.call !== "string" || parsed.call === "") {
    return { error: 'a step needs `call: "<tool name>"`, or `tools: true`' };
  }

  const args = parsed.args ?? {};
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { error: "`args` must be a JSON object" };
  }

  return {
    step: {
      kind: "call",
      line: at,
      tool: parsed.call,
      args,
      label: parsed.label ?? parsed.call,
      expect: asList(parsed.expect),
      expectNot: asList(parsed.expectNot),
    },
  };
}

/** One string or several: a step usually asserts one thing, sometimes three. */
function asList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Expand `{{NAME}}` wherever it appears in a step's arguments or a server's
 * arguments.
 *
 * The variable that matters is `TMPDIR`: a flow has to be able to say "the
 * directory this run is using" without knowing its name, or every run would
 * write into the same place and the second one would be reading the first
 * one's leftovers.
 */
export function substitute(params) {
  const { value, vars } = params;

  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (whole, name) => {
      return Object.hasOwn(vars, name) ? vars[name] : whole;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => substitute({ value: item, vars }));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute({ value: item, vars })])
    );
  }

  return value;
}

/**
 * What the step said would be in the response, against what came back.
 *
 * Substring rather than exact match, and deliberately so: these responses are
 * prose written for an agent to read, and a test that pins the whole of one
 * fails on every wording change while proving nothing more than that the
 * wording did not change.
 */
export function checkExpectations(params) {
  const { step, text } = params;
  const failures = [];

  for (const expected of step.expect) {
    if (!text.includes(expected)) {
      failures.push({ kind: "expect", line: step.line, expected });
    }
  }

  for (const unexpected of step.expectNot) {
    if (text.includes(unexpected)) {
      failures.push({ kind: "expectNot", line: step.line, expected: unexpected });
    }
  }

  return failures;
}

/** The text of a tool response, however many content parts it came in. */
export function responseText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => part?.text ?? "").join("\n");
}

export function formatFailure(failure) {
  const what = failure.kind === "expect" ? "expected but missing" : "expected to be absent";
  return `  line ${failure.line}: ${what}: ${JSON.stringify(failure.expected)}`;
}

/**
 * Parse `--env K=V`. A value may contain `=`, a name may not.
 */
export function parseEnvAssignment(assignment) {
  const at = assignment.indexOf("=");
  if (at < 1) return { error: `--env needs NAME=VALUE, got ${JSON.stringify(assignment)}` };
  return { name: assignment.slice(0, at), value: assignment.slice(at + 1) };
}

/**
 * The command line.
 *
 * Everything after a bare `--` goes to the server rather than to the runner,
 * which is how a server that takes its own arguments -- a documents directory,
 * an include filter -- is driven without this script knowing about any of them.
 */
export function parseArgs(argv) {
  const positional = [];
  const env = {};
  const serverArgs = [];
  let keep = false;
  let quiet = false;
  let afterSeparator = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (afterSeparator) {
      serverArgs.push(arg);
      continue;
    }

    if (arg === "--") {
      afterSeparator = true;
      continue;
    }

    if (arg === "--keep") {
      keep = true;
      continue;
    }

    if (arg === "--quiet") {
      quiet = true;
      continue;
    }

    if (arg === "--env") {
      const next = argv[i + 1];
      if (next === undefined) return { error: "--env needs NAME=VALUE" };
      const assignment = parseEnvAssignment(next);
      if (assignment.error !== undefined) return { error: assignment.error };
      env[assignment.name] = assignment.value;
      i++;
      continue;
    }

    if (arg.startsWith("-")) return { error: `unknown option ${arg}` };

    positional.push(arg);
  }

  if (positional.length < 2) {
    return { error: "usage: mcp-session.mjs <package> <flow.jsonl> [--env K=V] [--keep] [--quiet] [-- <server args>]" };
  }

  return {
    package: positional[0],
    flowPath: positional[1],
    env,
    serverArgs,
    keep,
    quiet,
  };
}
