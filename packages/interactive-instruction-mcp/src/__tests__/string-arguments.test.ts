/**
 * Booleans and numbers that arrive as strings.
 *
 * `instruction` publishes no argument types -- `describe` documents them -- so
 * a client has nothing to serialise against and can send `recursive: true` as
 * `"true"`. That is how `list(recursive: true)`, the first call CLAUDE.md asks
 * for, failed validation in a Claude Code session while being made exactly as
 * documented.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ListHandler } from "../tools/instruction/handlers/list.js";
import { GraphHandler } from "../tools/instruction/handlers/graph.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

let tempDir: string;
let docsDir: string;
let context: InstructionContext;

async function write(params: { id: string; relatedDocs?: string[] }): Promise<void> {
  const { id, relatedDocs = [] } = params;
  const lines = ["---", `description: about ${id}`];
  if (relatedDocs.length > 0) {
    lines.push("relatedDocs:", ...relatedDocs.map((r) => `  - ${r}`));
  }
  lines.push("---", "", `# ${id}`, "");

  const file = path.join(docsDir, `${id.split("__").join(path.sep)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join("\n"), "utf-8");
  context.reader.invalidateCache();
}

async function run(params: {
  handler: ListHandler | GraphHandler;
  rawParams: Record<string, unknown>;
}): Promise<{ text: string; isError?: boolean }> {
  const { handler, rawParams } = params;
  const result = await handler.execute({ rawParams, context });
  return {
    text: result.content[0].type === "text" ? result.content[0].text : "",
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "string-args-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("list", () => {
  const list = new ListHandler();

  it('treats recursive: "true" as recursive: true', async () => {
    await write({ id: "cat__inside" });

    const asString = await run({ handler: list, rawParams: { action: "list", recursive: "true" } });
    const asBoolean = await run({ handler: list, rawParams: { action: "list", recursive: true } });

    expect(asString.isError).toBeUndefined();
    expect(asString.text).toContain("inside");
    expect(asString.text).toBe(asBoolean.text);
  });

  it('treats recursive: "false" as recursive: false', async () => {
    await write({ id: "cat__inside" });

    const { text, isError } = await run({
      handler: list,
      rawParams: { action: "list", recursive: "false" },
    });

    expect(isError).toBeUndefined();
    expect(text).not.toContain("inside");
  });

  it('treats drafts: "true" as drafts: true', async () => {
    const asString = await run({ handler: list, rawParams: { action: "list", drafts: "true" } });
    const asBoolean = await run({ handler: list, rawParams: { action: "list", drafts: true } });

    expect(asString.isError).toBeUndefined();
    expect(asString.text).toBe(asBoolean.text);
  });

  it.each(["yes", "1", "TRUE", ""])("still rejects recursive: %j", async (value) => {
    const { isError } = await run({ handler: list, rawParams: { action: "list", recursive: value } });

    expect(isError).toBe(true);
  });
});

describe("graph", () => {
  const graph = new GraphHandler();

  it('treats depth: "2" as depth: 2', async () => {
    await write({ id: "a", relatedDocs: ["b"] });
    await write({ id: "b", relatedDocs: ["c"] });
    await write({ id: "c" });

    const base = { action: "graph", format: "text", id: "a" };
    const asString = await run({ handler: graph, rawParams: { ...base, depth: "2" } });
    const asNumber = await run({ handler: graph, rawParams: { ...base, depth: 2 } });

    expect(asString.isError).toBeFalsy();
    expect(asString.text).toContain("a, depth 2");
    expect(asString.text).toBe(asNumber.text);
  });

  it('treats includeUnlinked: "true" as includeUnlinked: true', async () => {
    await write({ id: "a", relatedDocs: ["b"] });
    await write({ id: "b" });
    await write({ id: "lonely" });

    const base = { action: "graph", format: "text" };
    const asString = await run({ handler: graph, rawParams: { ...base, includeUnlinked: "true" } });
    const asBoolean = await run({ handler: graph, rawParams: { ...base, includeUnlinked: true } });

    expect(asString.isError).toBeFalsy();
    expect(asString.text).toBe(asBoolean.text);
  });

  it.each([["depth", "two"], ["spacing", "wide"]])("still rejects %s: %j", async (name, value) => {
    const { isError } = await run({
      handler: graph,
      rawParams: { action: "graph", format: "text", [name]: value },
    });

    expect(isError).toBe(true);
  });
});
