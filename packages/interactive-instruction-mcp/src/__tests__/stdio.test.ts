/**
 * The server as a client actually meets it: a separate process, over stdio.
 *
 * Every other test in this package calls handlers in-process, which cannot see
 * the things that only exist at the process boundary -- whether the tool
 * schemas survive being serialised, whether an environment variable reaches
 * the server at all, whether a gate that keeps its state in memory keeps it
 * across two JSON-RPC calls. Those are exactly the failures that reach a user,
 * because they are what a client does.
 *
 * The server runs from `src/index.ts` through tsx rather than from `dist`. A
 * built bundle goes stale the moment someone edits a source file, and a test
 * that quietly checks last week's code is worse than no test. Whether the
 * bundle itself is sound is `verify-bundle.mjs`'s question.
 *
 * `scripts/mcp-session.mjs` drives the same server from a flow file, for the
 * exploring this does not cover.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DRAFT_DIR } from "../constants.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(packageRoot, "../..");

/**
 * Where pnpm put the tsx binary.
 *
 * `tsx` is this package's own devDependency, so the package-local `.bin` is
 * where it belongs -- but a workspace whose root declares it too can leave the
 * package-local link absent, and CI failed on exactly that (`spawn
 * .../node_modules/.bin/tsx ENOENT`) while every developer machine had the
 * link from an earlier install. Look in both rather than depend on which.
 */
async function tsxBinary(): Promise<string> {
  const candidates = [
    path.join(packageRoot, "node_modules", ".bin", "tsx"),
    path.join(repoRoot, "node_modules", ".bin", "tsx"),
  ];

  for (const candidate of candidates) {
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }

  throw new Error(`tsx not found in any of:\n${candidates.join("\n")}`);
}

/** The limit this server is started with, low enough to trip on a short document. */
const MAX_LINES = 20;

let docsDir: string;
let client: Client;
let transport: StdioClientTransport;

async function call(args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name: "instruction", arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return content.map((part) => part.text ?? "").join("\n");
}

beforeAll(async () => {
  docsDir = await fs.mkdtemp(path.join(os.tmpdir(), "iimcp-stdio-"));

  transport = new StdioClientTransport({
    command: await tsxBinary(),
    args: [path.join(packageRoot, "src", "index.ts"), docsDir],
    env: {
      ...process.env,
      IIMCP_LINT_MAX_LINES: String(MAX_LINES),
      // The workflow store is on disk and scoped per documents directory, but
      // say so explicitly: a test that shared it with the developer's own
      // running server would delete their state.
      MCP_DRAFT_PERSIST_DIR: path.join(docsDir, ".state"),
    },
    stderr: "inherit",
  });

  client = new Client({ name: "stdio-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close().catch(() => {});
  await fs.rm(docsDir, { recursive: true, force: true }).catch(() => {});
});

describe("over stdio", () => {
  it("offers the two tools, and no third", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["instruction", "instruction_describe"]);
  });

  it("serialises one merged input schema for every action", async () => {
    // The tool's inputSchema is assembled by merging every handler's `.shape`.
    // A refinement on any one of them wraps the object in a type that has no
    // shape, which takes out the parameters of every other action -- and the
    // only place that is visible is the schema a client receives.
    const { tools } = await client.listTools();
    const instruction = tools.find((tool) => tool.name === "instruction");
    const properties = Object.keys(instruction?.inputSchema.properties ?? {});

    expect(properties).toEqual(
      expect.arrayContaining(["action", "id", "content", "description", "whenToUse", "relatedDocs", "notes", "explanation"])
    );
  });

  it("reads a threshold from the environment of its own process", async () => {
    // In-process tests set `process.env` and read it back in the same process,
    // which says nothing about whether a spawned server ever sees it.
    const body = Array.from({ length: MAX_LINES + 10 }, (_, i) => `Line ${i + 1}.`).join("\n");

    const response = await call({
      action: "add",
      id: "stdio-long",
      content: body,
      description: "A document over the limit this server was started with",
      whenToUse: ["exercising the stdio boundary"],
    });

    expect(response).toContain("created successfully");
    expect(response).toContain(`max recommended: ${MAX_LINES}`);
  });

  it("writes the document to the directory it was started with", async () => {
    const saved = await fs.readFile(path.join(docsDir, DRAFT_DIR, "stdio-long.md"), "utf-8");

    expect(saved).toContain(`Line ${MAX_LINES + 10}.`);
  });

  it("holds the deliberation gate open across two calls in one session", async () => {
    // The gate is process memory. Two calls are two JSON-RPC round trips, and
    // whether the second one is recognised as the repeat of the first is the
    // whole mechanism -- invisible to a harness that starts a server per call.
    const id = "stdio-gate";
    const explanation = "This is the note we agreed to keep.";

    await call({
      action: "add",
      id,
      content: "# Gate\n\nShort enough to say nothing about its size.",
      description: "A draft to carry through the gate",
      whenToUse: ["exercising the gate over stdio"],
    });
    await call({ action: "approve", id, notes: "reviewed: one topic, ready" });

    const refused = await call({ action: "approve", id, explanation });
    expect(refused).toContain("Not Yet -- Tell the User First");

    const promoted = await call({ action: "approve", id, explanation });
    expect(promoted).not.toContain("Not Yet -- Tell the User First");
    expect(promoted).toContain("promoted");

    // And the promotion really moved the file, not just the state machine.
    expect(await fs.readFile(path.join(docsDir, `${id}.md`), "utf-8")).toContain(
      "Short enough to say nothing"
    );
  }, 20_000);
});
