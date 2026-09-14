/**
 * What the link, delete and rename actions say when the change empties or
 * collides with something.
 *
 * All three report back in prose that the caller relays to the user, so the
 * wording is the interface: "(none)" rather than a blank after the last link is
 * removed, a count of the documents left pointing at a deleted one, and a
 * rename that says out loud when the destination is occupied -- that last is
 * bound into the approval, so a document appearing at the destination between
 * attempts has to change the text rather than the meaning of the write.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
import { LinkRemoveHandler } from "../tools/instruction/handlers/link-remove.js";
import { DeleteHandler } from "../tools/instruction/handlers/delete.js";
import { RenameHandler } from "../tools/instruction/handlers/rename.js";
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { throughGate } from "./helpers/gate.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const EXPLANATION = "I told the user what this changes and why.";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;

const linkAdd = new LinkAddHandler();
const linkRemove = new LinkRemoveHandler();
const del = new DeleteHandler();
const rename = new RenameHandler();

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

async function write(params: { id: string; frontmatter?: string; body?: string }): Promise<void> {
  const { id, frontmatter = "", body = `# ${id}\n\nBody.\n` } = params;
  await fs.writeFile(
    path.join(docsDir, `${id}.md`),
    `---\ndescription: about ${id}\nwhenToUse:\n  - testing\n${frontmatter}---\n\n${body}`,
    "utf-8"
  );
  reader.invalidateCache();
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "link-edges-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  resetMutationGatesForTesting();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("adding a link to a document that has none", () => {
  it("says the current list is empty rather than leaving a blank", async () => {
    await write({ id: "hub" });
    await write({ id: "detail" });

    const first = await linkAdd.execute({
      rawParams: { action: "link_add", id: "hub", relatedDocs: ["detail"], explanation: EXPLANATION },
      context,
    });

    expect(text(first)).toContain("**Current relatedDocs:** (none)");
    expect(text(first)).toContain("**New relatedDocs:** detail");
  });
});

describe("removing the last link", () => {
  it("says the list is now empty, in the preview and after the write", async () => {
    await write({ id: "hub", frontmatter: "relatedDocs:\n  - detail\n" });
    await write({ id: "detail" });

    const call = () =>
      linkRemove.execute({
        rawParams: {
          action: "link_remove",
          id: "hub",
          relatedDocs: ["detail"],
          explanation: EXPLANATION,
        },
        context,
      });

    const first = await call();
    expect(text(first)).toContain("**New relatedDocs:** (none)");

    const { response } = await throughGate(call);
    expect(text(response)).toContain("**New relatedDocs:** (none)");
  });

  it("drops the key from the frontmatter rather than writing an empty list", async () => {
    // `relatedDocs: []` and no `relatedDocs` read the same to this server, but
    // the empty list is noise in a file the user also edits by hand.
    await write({ id: "hub", frontmatter: "relatedDocs:\n  - detail\n" });
    await write({ id: "detail" });

    await throughGate(() =>
      linkRemove.execute({
        rawParams: {
          action: "link_remove",
          id: "hub",
          relatedDocs: ["detail"],
          explanation: EXPLANATION,
        },
        context,
      })
    );

    const written = await fs.readFile(path.join(docsDir, "hub.md"), "utf-8");
    expect(written).not.toContain("relatedDocs");
  });
});

describe("deleting a document others still point at", () => {
  it("says how many links are left dangling", async () => {
    // The links are not rewritten -- that would edit documents nobody asked
    // about -- so the caller has to be told they now dangle.
    await write({ id: "target" });
    await write({ id: "referrer-a", frontmatter: "relatedDocs:\n  - target\n" });
    await write({ id: "referrer-b", frontmatter: "relatedDocs:\n  - target\n" });

    const { response } = await throughGate(() =>
      del.execute({
        rawParams: { action: "delete", id: "target", explanation: EXPLANATION },
        context,
      })
    );

    expect(text(response)).toContain("2 document(s) still link to");
    expect(await reader.documentExists("target")).toBe(false);
  });

  it("does not mention dangling links when there are none", async () => {
    await write({ id: "lonely" });

    const { response } = await throughGate(() =>
      del.execute({
        rawParams: { action: "delete", id: "lonely", explanation: EXPLANATION },
        context,
      })
    );

    expect(text(response)).not.toContain("still link to");
  });
});

describe("renaming onto an occupied destination", () => {
  it("says so in the approval, so the caller cannot be shown one move and get another", async () => {
    await write({ id: "source" });
    await write({ id: "destination" });

    const first = await rename.execute({
      rawParams: {
        action: "rename",
        id: "source",
        newId: "destination",
        explanation: EXPLANATION,
      },
      context,
    });

    expect(text(first)).toContain("destination");

    const { response } = await throughGate(() =>
      rename.execute({
        rawParams: {
          action: "rename",
          id: "source",
          newId: "destination",
          explanation: EXPLANATION,
        },
        context,
      })
    );

    // Past the gate, and still refused: the destination is occupied, and this
    // action does not overwrite.
    expect(response.isError).toBe(true);
    expect(await reader.documentExists("source")).toBe(true);
    expect(await reader.getDocumentContent("destination")).toContain("about destination");
  });
});
