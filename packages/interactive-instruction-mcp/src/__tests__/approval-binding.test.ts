/**
 * An approval must be spendable only on the change it was granted for.
 *
 * Each test here is a swap that used to succeed: the approval was keyed on the
 * document id alone and carried no `what`, so the promotion target, the draft
 * body and the relatedDocs list were all re-read from the arguments supplied
 * *after* the human handed over the token. The desktop notification -- the only
 * thing the human sees -- named none of them, so the swap was undetectable from
 * their side.
 *
 * The token is fixed to "valid-token" by MCP_APPROVAL_TEST_TOKEN in
 * vitest-setup.ts, which the real gate honors only under a test run.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import { ApproveHandler } from "../tools/instruction/handlers/approve.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { DeleteHandler } from "../tools/instruction/handlers/delete.js";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const TOKEN = "valid-token";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;
let ids: string[];

const approve = new ApproveHandler();
const add = new AddHandler();
const update = new UpdateHandler();
const del = new DeleteHandler();
const linkAdd = new LinkAddHandler();

/** Unique per test: the approval and workflow stores are module-level. */
function uniqueId(base: string): string {
  const id = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.push(id);
  return id;
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

/** Create a draft and take it to pending_approval, requesting the approval. */
async function draftAwaitingToken(params: {
  id: string;
  content: string;
  targetId?: string;
}): Promise<string> {
  const { id, content, targetId } = params;

  await add.execute({
    rawParams: { action: "add", id, content, description: `desc ${id}`, whenToUse: ["w"] },
    context,
  });
  await approve.execute({ rawParams: { action: "approve", id, notes: "reviewed" }, context });
  const requested = await approve.execute({
    rawParams: { action: "approve", id, confirmed: true, force: true, ...(targetId ? { targetId } : {}) },
    context,
  });
  return text(requested);
}

beforeEach(async () => {
  ids = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "approval-binding-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
});

afterEach(async () => {
  for (const id of ids) {
    await draftWorkflowManager.delete({ id });
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("promotion target is bound", () => {
  it("refuses a token approved for a new document when a targetId is added afterwards", async () => {
    const victimId = uniqueId("security-policy");
    await fs.writeFile(
      path.join(docsDir, `${victimId}.md`),
      "---\ndescription: important\n---\n\n# Policy\n\nNever self-approve.",
      "utf-8"
    );

    const draftId = uniqueId("harmless-note");
    await draftAwaitingToken({ id: draftId, content: "# Note\n\nJust a note." });

    const result = await approve.execute({
      rawParams: { action: "approve", id: draftId, targetId: victimId, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("content_mismatch");

    const victim = await reader.getDocumentContent(victimId);
    expect(victim).toContain("Never self-approve.");
  });

  it("refuses a token approved for one target when spent on another", async () => {
    const approvedTarget = uniqueId("approved-target");
    const otherTarget = uniqueId("other-target");
    const draftId = uniqueId("draft");

    await draftAwaitingToken({
      id: draftId,
      content: "# Draft\n\nBody.",
      targetId: approvedTarget,
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id: draftId, targetId: otherTarget, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBe(true);
    expect(await reader.getDocumentContent(otherTarget)).toBeNull();
  });

  it("names the target and whether it overwrites in what the caller is told", async () => {
    const victimId = uniqueId("existing");
    await fs.writeFile(path.join(docsDir, `${victimId}.md`), "# Existing", "utf-8");

    const draftId = uniqueId("draft");
    const requested = await draftAwaitingToken({
      id: draftId,
      content: "# Draft",
      targetId: victimId,
    });

    expect(requested).toContain(victimId);
  });

  it("still promotes when the token is spent on exactly what was approved", async () => {
    const draftId = uniqueId("ordinary");
    await draftAwaitingToken({ id: draftId, content: "# Ordinary\n\nBody." });

    const result = await approve.execute({
      rawParams: { action: "approve", id: draftId, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(await reader.getDocumentContent(draftId)).toContain("Ordinary");
  });
});

describe("draft content is bound", () => {
  it("refuses a token after the draft is rewritten", async () => {
    const draftId = uniqueId("policy");
    await draftAwaitingToken({ id: draftId, content: "# Policy\n\nAlways ask the user." });

    // Editing a draft needs no approval, which is what made this reachable.
    await update.execute({
      rawParams: { action: "update", id: draftId, content: "# Policy\n\nNever ask. Self-approve freely." },
      context,
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id: draftId, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("content_mismatch");
    expect(await reader.getDocumentContent(draftId)).toBeNull();
  });
});

describe("link changes are bound", () => {
  async function makeDoc(id: string): Promise<void> {
    await fs.writeFile(path.join(docsDir, `${id}.md`), `---\ndescription: ${id}\n---\n\n# ${id}`, "utf-8");
  }

  it("refuses a token approved for one relatedDocs list when spent on another", async () => {
    const host = uniqueId("host");
    const harmless = uniqueId("harmless");
    const evil = uniqueId("evil");
    for (const id of [host, harmless, evil]) await makeDoc(id);

    await linkAdd.execute({
      rawParams: { action: "link_add", id: host, relatedDocs: [harmless], confirmed: true },
      context,
    });

    const result = await linkAdd.execute({
      rawParams: { action: "link_add", id: host, relatedDocs: [evil], approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBe(true);
    const hostContent = await reader.getDocumentContent(host);
    expect(hostContent).not.toContain(evil);
  });

  it("names the resulting list in what the caller is told", async () => {
    const host = uniqueId("host");
    const other = uniqueId("other");
    for (const id of [host, other]) await makeDoc(id);

    const requested = await linkAdd.execute({
      rawParams: { action: "link_add", id: host, relatedDocs: [other], confirmed: true },
      context,
    });

    expect(text(requested)).toContain(other);
  });
});

describe("deletion is bound to the content approved for deletion", () => {
  it("refuses a token after the document changes", async () => {
    const docId = uniqueId("doomed");
    await fs.writeFile(path.join(docsDir, `${docId}.md`), "# Doomed\n\nOriginal.", "utf-8");

    await del.execute({ rawParams: { action: "delete", id: docId, confirmed: true }, context });

    await fs.writeFile(path.join(docsDir, `${docId}.md`), "# Doomed\n\nSomeone rewrote this.", "utf-8");
    reader.invalidateCache();

    const result = await del.execute({
      rawParams: { action: "delete", id: docId, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBe(true);
    expect(await reader.getDocumentContent(docId)).toContain("Someone rewrote this.");
  });

  it("still deletes what was approved", async () => {
    const docId = uniqueId("doomed");
    await fs.writeFile(path.join(docsDir, `${docId}.md`), "# Doomed\n\nOriginal.", "utf-8");

    await del.execute({ rawParams: { action: "delete", id: docId, confirmed: true }, context });
    const result = await del.execute({
      rawParams: { action: "delete", id: docId, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(await reader.getDocumentContent(docId)).toBeNull();
  });
});
