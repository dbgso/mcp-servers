/**
 * What the handlers do when the write does not happen.
 *
 * These are the branches coverage found bare after the write paths were routed
 * through the reader: the guards and the failure returns were added, and
 * nothing exercised them. A handler that reports success after a failed write
 * is worse than one that cannot write at all, so each of them is checked here
 * by making the reader fail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { DeleteHandler } from "../tools/instruction/handlers/delete.js";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
import { LinkRemoveHandler } from "../tools/instruction/handlers/link-remove.js";
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

const EXPLANATION = "Because the document needs it.";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;

const doc = (id: string) => `---\ndescription: ${id}\nwhenToUse:\n  - testing\n---\n\n# ${id}\n\nBody.\n`;

async function promoted(id: string): Promise<void> {
  await fs.writeFile(path.join(docsDir, `${id}.md`), doc(id), "utf-8");
  reader.invalidateCache();
}

async function draft(id: string): Promise<void> {
  await fs.writeFile(path.join(docsDir, DRAFT_DIR, `${id}.md`), doc(id), "utf-8");
  reader.invalidateCache();
}

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-failure-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempDir, { recursive: true, force: true });
});

/** Make every write through the reader fail. */
function breakWrites(error = "simulated disk failure"): void {
  vi.spyOn(reader, "updateDocument").mockResolvedValue({ success: false, error });
}

describe("a draft and a promoted document under the same id", () => {
  it("stops delete rather than guessing which one was meant", async () => {
    await draft("both");
    await promoted("both");

    const result = await new DeleteHandler().execute({
      rawParams: { action: "delete", id: "both", explanation: EXPLANATION },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Both draft and promoted");
    // Neither copy is touched.
    expect(await reader.documentExists(DRAFT_PREFIX + "both")).toBe(true);
    expect(await reader.documentExists("both")).toBe(true);
  });

  it("stops update for the same reason", async () => {
    await draft("both");
    await promoted("both");

    const result = await new UpdateHandler().execute({
      rawParams: { action: "update", id: "both", description: "changed" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Both draft and promoted");
  });
});

describe("link_remove on a document that is not there", () => {
  it("says so instead of writing one", async () => {
    const result = await new LinkRemoveHandler().execute({
      rawParams: {
        action: "link_remove",
        id: "absent",
        relatedDocs: ["whatever"],
        explanation: EXPLANATION,
      },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });
});

describe("the write fails", () => {
  it("link_add reports it", async () => {
    await promoted("host");
    await promoted("target");

    const call = () =>
      new LinkAddHandler().execute({
        rawParams: {
          action: "link_add",
          id: "host",
          relatedDocs: ["target"],
          explanation: EXPLANATION,
        },
        context,
      });

    let result = await call();
    breakWrites();
    result = await call();

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated disk failure");
  });

  it("link_remove reports it", async () => {
    await fs.writeFile(
      path.join(docsDir, "host.md"),
      `---\ndescription: host\nwhenToUse:\n  - testing\nrelatedDocs:\n  - target\n---\n\n# host\n`,
      "utf-8"
    );
    await promoted("target");
    reader.invalidateCache();

    const call = () =>
      new LinkRemoveHandler().execute({
        rawParams: {
          action: "link_remove",
          id: "host",
          relatedDocs: ["target"],
          explanation: EXPLANATION,
        },
        context,
      });

    let result = await call();
    breakWrites();
    result = await call();

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated disk failure");
    // The link is still there, which is what makes the error worth reporting.
    expect(await reader.getDocumentContent("host")).toContain("target");
  });

  it("a draft update reports it", async () => {
    await draft("drafted");
    breakWrites();

    const result = await new UpdateHandler().execute({
      rawParams: { action: "update", id: "drafted", content: "# Rewritten\n" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated disk failure");
  });

  it("a draft delete reports it", async () => {
    await draft("drafted");
    vi.spyOn(reader, "deleteDocument").mockResolvedValue({
      success: false,
      error: "simulated unlink failure",
    });

    const result = await new DeleteHandler().execute({
      rawParams: { action: "delete", id: "drafted" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated unlink failure");
  });

  it("a promoted delete reports it, and the document stays", async () => {
    await promoted("doomed");
    vi.spyOn(reader, "trashDocument").mockResolvedValue({
      success: false,
      error: "simulated rename failure",
    });

    const { response } = await throughGate(() =>
      new DeleteHandler().execute({
        rawParams: { action: "delete", id: "doomed", explanation: EXPLANATION },
        context,
      })
    );

    expect(response.isError).toBe(true);
    expect(text(response)).toContain("simulated rename failure");
    expect(await reader.documentExists("doomed")).toBe(true);
  });
});

describe("a document with no metadata at all", () => {
  it("is written back unchanged rather than given an empty frontmatter block", async () => {
    // `add` needs a description, so the only way to hold a document with none
    // is to write it directly -- and an update that adds no metadata either
    // must not invent a `---\n---` block at the top of it.
    const body = "Just a body, no heading and no frontmatter.\n";
    await fs.writeFile(path.join(docsDir, DRAFT_DIR, "bare.md"), body, "utf-8");
    reader.invalidateCache();

    await new UpdateHandler().execute({
      rawParams: { action: "update", id: "bare", content: body },
      context,
    });

    const written = await reader.getDocumentContent(DRAFT_PREFIX + "bare");
    expect(written).toBe(body);
    expect(written).not.toContain("---");
  });
});

describe("add refuses a draft it cannot describe", () => {
  it("reports the reader's rejection", async () => {
    vi.spyOn(reader, "addDocument").mockResolvedValue({
      success: false,
      error: "simulated add failure",
    });

    const result = await new AddHandler().execute({
      rawParams: { action: "add", id: "nope", content: "# X\n", description: "d", whenToUse: ["w"] },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated add failure");
  });
});
