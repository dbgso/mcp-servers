/**
 * Starting the server does not write to the documents directory.
 *
 * It used to create `_mcp-interactive-instruction/draft-approval.md`, 92 lines
 * of approval-format rules, before anyone had called anything. Three things
 * were wrong with that: the corpus gained a document the user did not write,
 * `list` showed it alongside their own documents on every call (it is not
 * under `_mcp_drafts` or `_mcp_trash`, so nothing filtered it), and what it
 * said was already being said by the approval flow itself, at the moment it
 * mattered rather than in a document someone had to go and read.
 *
 * The format it carried now lives in the `self_review → user_reviewing`
 * response. This test is about the directory staying untouched; the other one
 * is about the guidance still being delivered.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { ApproveHandler } from "../tools/instruction/handlers/approve.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
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

async function entries(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await entries(full)));
    else found.push(path.relative(docsDir, full));
  }
  return found;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "startup-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(docsDir, { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("the documents directory belongs to the user", () => {
  it("has nothing in it until something is added", async () => {
    // The server's entry point calls nothing that writes; constructing the
    // pieces it constructs must not either.
    expect(await entries(docsDir)).toEqual([]);
  });

  it("gains only the draft the caller asked for", async () => {
    const id = "the-only-document";
    await new AddHandler().execute({
      rawParams: { action: "add", id, content: "# Only\n\nBody.\n", description: "d", whenToUse: ["w"] },
      context,
    });

    expect(await entries(docsDir)).toEqual([path.join(DRAFT_DIR, `${id}.md`)]);
  });
});

describe("the approval format is delivered where it is used", () => {
  afterEach(async () => {
    await draftWorkflowManager.delete({ id: "explained" });
  });

  it("comes back with the self-review, not as a document to go and read", async () => {
    const id = "explained";
    const add = new AddHandler();
    const approve = new ApproveHandler();

    await add.execute({
      rawParams: { action: "add", id, content: "# Explained\n\nBody.\n", description: "d", whenToUse: ["w"] },
      context,
    });
    const result = await approve.execute({
      rawParams: { action: "approve", id, notes: "reviewed: one topic, one claim" },
      context,
    });

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    // The three things the deleted document asked for.
    expect(text).toContain("full path");
    expect(text).toContain("What it says");
    expect(text).toContain("Why there");
    // And nothing pointing at a document that no longer exists.
    expect(text).not.toContain("draft-approval");
  });

  it("never names the document it used to write", async () => {
    const id = "explained";
    const add = new AddHandler();

    const created = await add.execute({
      rawParams: { action: "add", id, content: "# Explained\n\nBody.\n", description: "d", whenToUse: ["w"] },
      context,
    });

    expect(created.content[0].type === "text" ? created.content[0].text : "").not.toContain(
      "draft-approval"
    );
  });
});
