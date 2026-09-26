/**
 * A gate run must be spendable only on the change it was opened for.
 *
 * Each test here is a swap that used to succeed. Back then the gate was a
 * token: the approval was keyed on the document id alone and carried no
 * `what`, so the promotion target, the draft body and the relatedDocs list
 * were all re-read from the arguments supplied *after* the human handed the
 * token over, and the notification named none of them.
 *
 * The token is gone -- every mutation here goes through the deliberation gate
 * now -- but the property has to survive the change of mechanism, and it is
 * carried differently. The run key is a hash of the operation, the
 * tool-computed `what`, and the caller's explanation. So a swapped argument is
 * not a spent approval on the wrong change; it is a different key, which means
 * a fresh run, which means refused. These tests say that in each of the places
 * the swap used to work.
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
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";


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

const EXPLANATION = "This document records the policy we agreed on.";

/**
 * Create a draft, self-review it, and make the first promotion attempt -- the
 * one the gate refuses. What comes back is the preview the caller reads before
 * committing, and the run it opened is what the swaps below try to spend.
 */
async function draftWithRunOpen(params: {
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
  const refused = await approve.execute({
    rawParams: {
      action: "approve",
      id,
      explanation: EXPLANATION,
      force: true,
      ...(targetId ? { targetId } : {}),
    },
    context,
  });
  return text(refused);
}

beforeEach(async () => {
  ids = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "approval-binding-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  for (const id of ids) {
    await draftWorkflowManager.delete({ id });
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("promotion target is bound", () => {
  it("refuses a run opened for a new document when a targetId is added afterwards", async () => {
    const victimId = uniqueId("security-policy");
    await fs.writeFile(
      path.join(docsDir, `${victimId}.md`),
      "---\ndescription: important\n---\n\n# Policy\n\nNever self-approve.",
      "utf-8"
    );

    const draftId = uniqueId("harmless-note");
    await draftWithRunOpen({ id: draftId, content: "# Note\n\nJust a note." });

    // Same draft, same explanation, different target: the target is in `what`,
    // so this cannot continue the open run -- it is a new one, refused from
    // attempt one.
    //
    // Be precise about what that buys. Under the token this swap was
    // impossible: the proof was minted for one `what` and validated against
    // another. Deliberation only makes it cost another disclosure round -- a
    // caller that repeats the swapped call does eventually get through. What
    // the binding still guarantees is that the swap cannot ride in on the run
    // the user was shown, so it cannot happen in the same breath as the
    // preview.
    const swapped = await approve.execute({
      rawParams: { action: "approve", id: draftId, targetId: victimId, explanation: EXPLANATION },
      context,
    });
    expect(isRefusal(swapped)).toBe(true);

    const victim = await reader.getDocumentContent(victimId);
    expect(victim).toContain("Never self-approve.");
  });

  it("refuses a run opened for one target when spent on another", async () => {
    const approvedTarget = uniqueId("approved-target");
    const otherTarget = uniqueId("other-target");
    const draftId = uniqueId("draft");

    await draftWithRunOpen({
      id: draftId,
      content: "# Draft\n\nBody.",
      targetId: approvedTarget,
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id: draftId, targetId: otherTarget, explanation: EXPLANATION },
      context,
    });

    expect(isRefusal(result)).toBe(true);
    expect(await reader.getDocumentContent(otherTarget)).toBeNull();
  });

  it("names the target and whether it overwrites in what the caller is told", async () => {
    const victimId = uniqueId("existing");
    await fs.writeFile(path.join(docsDir, `${victimId}.md`), "# Existing", "utf-8");

    const draftId = uniqueId("draft");
    const refused = await draftWithRunOpen({
      id: draftId,
      content: "# Draft",
      targetId: victimId,
    });

    expect(refused).toContain(victimId);
    // The caller is about to overwrite a document. That has to be in the text
    // it reads, not only in the hash it is keyed on.
    expect(refused).toContain("OVERWRITE");
  });

  it("still promotes when the repeat is of exactly what was previewed", async () => {
    const draftId = uniqueId("ordinary");
    await draftWithRunOpen({ id: draftId, content: "# Ordinary\n\nBody." });

    const { response } = await throughGate(() =>
      approve.execute({
        rawParams: { action: "approve", id: draftId, explanation: EXPLANATION, force: true },
        context,
      })
    );

    expect(response.isError).toBeFalsy();
    expect(await reader.getDocumentContent(draftId)).toContain("Ordinary");
  });
});

describe("draft content is bound", () => {
  it("refuses the repeat after the draft is rewritten", async () => {
    const draftId = uniqueId("policy");
    await draftWithRunOpen({ id: draftId, content: "# Policy\n\nAlways ask the user." });

    // Editing a draft needs no approval, which is what made this reachable:
    // the caller previewed one body to the user and promoted another.
    await update.execute({
      rawParams: { action: "update", id: draftId, content: "# Policy\n\nNever ask. Self-approve freely." },
      context,
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id: draftId, explanation: EXPLANATION, force: true },
      context,
    });

    expect(isRefusal(result)).toBe(true);
    expect(await reader.getDocumentContent(draftId)).toBeNull();
  });
});

describe("link changes are bound", () => {
  async function makeDoc(id: string): Promise<void> {
    await fs.writeFile(path.join(docsDir, `${id}.md`), `---\ndescription: ${id}\n---\n\n# ${id}`, "utf-8");
  }

  it("refuses a run opened for one relatedDocs list when spent on another", async () => {
    const host = uniqueId("host");
    const harmless = uniqueId("harmless");
    const evil = uniqueId("evil");
    for (const id of [host, harmless, evil]) await makeDoc(id);

    const explanation = "The host document should lead to the related one.";

    await linkAdd.execute({
      rawParams: { action: "link_add", id: host, relatedDocs: [harmless], explanation },
      context,
    });

    // A new key, so the swap starts at attempt one rather than spending the
    // run opened for `harmless`.
    const swapped = await linkAdd.execute({
      rawParams: { action: "link_add", id: host, relatedDocs: [evil], explanation },
      context,
    });
    expect(isRefusal(swapped)).toBe(true);

    const hostContent = await reader.getDocumentContent(host);
    expect(hostContent).not.toContain(evil);
  });

  it("names the resulting list in what the caller is told", async () => {
    const host = uniqueId("host");
    const other = uniqueId("other");
    for (const id of [host, other]) await makeDoc(id);

    // The notification this used to check is gone: a relatedDocs change is
    // reversible by the opposite action, so it goes through the deliberation
    // gate. The list still has to be named -- now in the preview the refusal
    // carries, which is what the caller reads before committing.
    const refused = await linkAdd.execute({
      rawParams: {
        action: "link_add",
        id: host,
        relatedDocs: [other],
        explanation: "The host document should lead to the other one.",
      },
      context,
    });

    expect(text(refused)).toContain(other);
    expect(text(refused)).toContain("Not Yet");
  });
});

describe("deletion is bound to the content it was previewed against", () => {
  const explanation = "This document is superseded and should go.";

  it("refuses the repeat after the document changes", async () => {
    const docId = uniqueId("doomed");
    await fs.writeFile(path.join(docsDir, `${docId}.md`), "# Doomed\n\nOriginal.", "utf-8");

    await del.execute({ rawParams: { action: "delete", id: docId, explanation }, context });

    await fs.writeFile(path.join(docsDir, `${docId}.md`), "# Doomed\n\nSomeone rewrote this.", "utf-8");
    reader.invalidateCache();

    // The content is in `what`, so the rewrite starts a new run: what the user
    // was shown is not what would now be deleted.
    const result = await del.execute({ rawParams: { action: "delete", id: docId, explanation }, context });

    expect(isRefusal(result)).toBe(true);
    expect(await reader.getDocumentContent(docId)).toContain("Someone rewrote this.");
  });

  it("deletes what it previewed, and keeps the bytes", async () => {
    const docId = uniqueId("doomed");
    await fs.writeFile(path.join(docsDir, `${docId}.md`), "# Doomed\n\nOriginal.", "utf-8");

    const { response } = await throughGate(() =>
      del.execute({ rawParams: { action: "delete", id: docId, explanation }, context })
    );

    expect(response.isError).toBeFalsy();
    expect(await reader.getDocumentContent(docId)).toBeNull();

    // Deliberation proves disclosure, not consent, so the safety of a delete
    // rests on the file still being there.
    const trashed = await fs.readdir(path.join(docsDir, "_mcp_trash"));
    expect(trashed.some((name) => name.startsWith(docId))).toBe(true);
  });
});
