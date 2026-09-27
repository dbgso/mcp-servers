/**
 * Setting the field `lint` tells you to set.
 *
 * 2.0.0 shipped `document-too-large` with "set `sizeExemption` to say why it
 * stays whole", and no way to set it: `update` and `add` took `content`,
 * `description`, `whenToUse` and `relatedDocs` and nothing else. Everything
 * below the entry point was already there -- the type, the parser, the writer,
 * `read_meta`'s display -- so the one thing missing was the argument.
 *
 * The round trip is the test, because the halves are useless apart: a write that
 * could set but not clear would leave `stale-size-exemption`'s "remove it"
 * unactionable, which is the same defect one field over.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { ReadMetaHandler } from "../tools/instruction/handlers/read-meta.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const LONG = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");

let tempDir: string;
let docsDir: string;
let context: InstructionContext;

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

const call = async (handler: { execute: (p: { rawParams: unknown; context: InstructionContext }) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }> }, rawParams: unknown) =>
  handler.execute({ rawParams, context });

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "size-exemption-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
});

afterEach(async () => {
  await draftWorkflowManager.delete({ id: "big" }).catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function draftBody(): Promise<string> {
  return (await fs.readFile(path.join(docsDir, DRAFT_DIR, "big.md"), "utf-8"));
}

describe("sizeExemption through the tool", () => {
  it("is reported, then set, then reported again once removed", async () => {
    const added = await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
    });
    // The write itself says the document is over the line, and names the call.
    expect(text(added)).toContain("document-too-large");
    expect(text(added)).toContain('sizeExemption: "<why>"');

    const beforeLint = await call(new LintHandler(), { action: "lint" });
    expect(text(beforeLint)).toContain("document-too-large");

    const set = await call(new UpdateHandler(), {
      action: "update", id: "big",
      sizeExemption: "A reference table; it is worth more in one piece.",
    });
    expect(set.isError).toBeFalsy();
    expect(await draftBody()).toContain("sizeExemption:");

    const afterLint = await call(new LintHandler(), { action: "lint" });
    expect(text(afterLint)).not.toContain("document-too-large");

    const cleared = await call(new UpdateHandler(), {
      action: "update", id: "big", sizeExemption: null,
    });
    expect(cleared.isError).toBeFalsy();
    expect(await draftBody()).not.toContain("sizeExemption");

    const finalLint = await call(new LintHandler(), { action: "lint" });
    expect(text(finalLint)).toContain("document-too-large");
  });

  it("changes the metadata without being sent the body", async () => {
    // The point of the field being metadata: a document is not resent to
    // declare a decision about it.
    await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
    });
    const before = await draftBody();

    await call(new UpdateHandler(), { action: "update", id: "big", sizeExemption: "Deliberate." });
    const after = await draftBody();

    expect(after).toContain("line 199");
    expect(after.split("\n").filter((l) => l.startsWith("line ")).length)
      .toBe(before.split("\n").filter((l) => l.startsWith("line ")).length);
  });

  it("can be set at creation", async () => {
    const added = await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
      sizeExemption: "A runbook; the steps have to stay in order.",
    });

    expect(text(added)).not.toContain("document-too-large");
    expect(await draftBody()).toContain("A runbook");
  });

  it("is refused as a lone argument only when it is absent", async () => {
    // `update(id)` with nothing to change is still refused, and the refusal now
    // names this field among the ones that would make the call do something.
    await call(new AddHandler(), {
      action: "add", id: "big", content: "# Big\n\nshort",
      description: "a doc", whenToUse: ["testing"],
    });

    const nothing = await call(new UpdateHandler(), { action: "update", id: "big" });
    expect(nothing.isError).toBe(true);
    expect(text(nothing)).toContain("sizeExemption");
  });

  it("shows up in read_meta once set", async () => {
    await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
      sizeExemption: "Deliberately whole.",
    });

    const meta = await call(new ReadMetaHandler(), { action: "read_meta", id: DRAFT_PREFIX + "big" });

    expect(text(meta)).toContain("Deliberately whole.");
  });
});
