#!/usr/bin/env node
/**
 * Drive an MCP server through a flow of calls, in one process.
 *
 * `mcp-test.sh` starts a server, makes one call and exits, which is enough for
 * a stateless tool and useless for everything else: a deliberation gate needs
 * the same call twice in one session, a draft needs `add` then `approve`, a
 * staged update needs `update` then `apply`. None of that can be seen one
 * process at a time.
 *
 * So the server stays up for the whole flow, and the flow is a file -- which
 * means a session that found something can be committed, handed to someone
 * else, or replayed after the fix.
 *
 *   node scripts/mcp-session.mjs interactive-instruction-mcp flow.jsonl -- '{{TMPDIR}}'
 *
 * The server runs from `src/index.ts` through tsx, not from `dist`. A built
 * bundle goes stale the moment someone edits a source file, and a harness that
 * quietly tests last week's code is worse than no harness. Whether the bundle
 * itself is sound is `verify-bundle.mjs`'s question.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkExpectations,
  formatFailure,
  parseArgs,
  parseFlow,
  responseText,
  substitute,
} from "./lib/mcp-session-flow.mjs";

const scriptDir = import.meta.dirname;
const repoRoot = path.dirname(scriptDir);

function fail(message) {
  console.error(message);
  process.exit(2);
}

const options = parseArgs(process.argv.slice(2));
if (options.error !== undefined) fail(options.error);

const entry = path.join(repoRoot, "packages", options.package, "src", "index.ts");
if (!(await exists(entry))) {
  fail(`No such server: ${path.relative(repoRoot, entry)}`);
}

const flowText = await fs.readFile(options.flowPath, "utf-8").catch((error) => {
  fail(`Cannot read flow: ${error.message}`);
});

const { steps, errors } = parseFlow(flowText);
if (errors.length > 0) {
  fail(["Flow file has errors:", ...errors.map((e) => `  line ${e.line}: ${e.message}`)].join("\n"));
}
if (steps.length === 0) fail("Flow file has no steps.");

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), `mcp-session-${options.package}-`));
const vars = { TMPDIR: scratch };

// Every on-disk store this repository's servers keep is overridable by
// environment, and a session that shared them with the developer's own running
// server would read and delete its state. They go under the scratch directory
// unless the flow's own `--env` says otherwise.
const env = {
  ...process.env,
  MCP_DRAFT_PERSIST_DIR: path.join(scratch, ".state", "drafts"),
  MCP_INSTRUCTION_PENDING_DIR: path.join(scratch, ".state", "pending"),
  MCP_INSTRUCTION_DIFF_DIR: path.join(scratch, ".state", "diffs"),
  ...substitute({ value: options.env, vars }),
};

const transport = new StdioClientTransport({
  command: path.join(repoRoot, "node_modules", ".bin", "tsx"),
  args: [entry, ...substitute({ value: options.serverArgs, vars })],
  env,
  // Inherited, not piped: when a server refuses to start -- a missing
  // documents directory, a bad flag -- what it printed on the way out is the
  // whole answer, and a harness that swallows it is how `mcp-test.sh` came to
  // report "no output, exit 0" for a server that never ran.
  stderr: "inherit",
});

const client = new Client({ name: "mcp-session", version: "1.0.0" }, { capabilities: {} });

let failures = [];
let calls = 0;
let expectations = 0;
let crashed = null;

try {
  await client.connect(transport);

  for (const step of steps) {
    if (step.kind === "tools") {
      const listed = await client.listTools();
      report({ step, text: listed.tools.map((t) => `${t.name}: ${t.description ?? ""}`).join("\n") });
      continue;
    }

    const args = substitute({ value: step.args, vars });
    const result = await client.callTool({ name: step.tool, arguments: args });
    const text = responseText(result);
    calls++;

    report({ step, text, args, isError: result.isError === true });

    expectations += step.expect.length + step.expectNot.length;
    failures = [...failures, ...checkExpectations({ step, text })];
  }
} catch (error) {
  // A stack trace out of the SDK says nothing a reader of this harness can
  // act on; what went wrong is either above, in the server's own stderr, or
  // in the message.
  crashed = error instanceof Error ? error.message : String(error);
} finally {
  await client.close().catch(() => {});
  if (options.keep) console.error(`\nScratch directory kept: ${scratch}`);
  else await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}

function report(params) {
  const { step, text, args, isError } = params;
  if (options.quiet) {
    console.log(text);
    return;
  }

  const marker = isError === true ? " [isError]" : "";
  console.log(`\n### ${step.label}${marker}`);
  if (args !== undefined) console.log(`> ${step.tool} ${JSON.stringify(args)}`);
  console.log("");
  console.log(text);
}

if (!options.quiet) {
  console.log(
    `\n--- ${calls} call(s), ${expectations} expectation(s), ${failures.length} failed ---`
  );
}

if (crashed !== null) {
  console.error(`\nSession failed after ${calls} call(s): ${crashed}`);
  process.exit(2);
}

if (failures.length > 0) {
  console.error("\nUnmet expectations:");
  for (const failure of failures) console.error(formatFailure(failure));
  process.exit(1);
}

async function exists(file) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}
