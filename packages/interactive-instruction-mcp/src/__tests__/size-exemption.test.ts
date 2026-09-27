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

/**
 * The value `null` cannot always reach here.
 *
 * Some MCP clients render tool arguments as strings, so `sizeExemption: null`
 * arrives as the four characters `null`. 2.0.1 stored that as the reason: the
 * call `stale-size-exemption` recommends did nothing, the finding came back
 * saying the same thing, and the document was left claiming its reason for
 * staying whole was "null".
 */
describe("a value that is not a reason", () => {
  it.each(["null", "undefined", "NULL", "  null  "])("refuses %o rather than storing it", async (given) => {
    await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
      sizeExemption: "A real reason.",
    });

    const result = await call(new UpdateHandler(), { action: "update", id: "big", sizeExemption: given });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("is not a reason");
    // The refusal has to carry the call that removes it, because removing is
    // what the caller was trying to do.
    expect(text(result)).toContain('sizeExemption: ""');
    // And the reason that was there is untouched.
    expect(await draftBody()).toContain("A real reason.");
  });

  it("takes an empty string as removal, which a stringifying client can send", async () => {
    await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
      sizeExemption: "A real reason.",
    });

    const result = await call(new UpdateHandler(), { action: "update", id: "big", sizeExemption: "" });

    expect(result.isError).toBeFalsy();
    expect(await draftBody()).not.toContain("sizeExemption");
    expect(text(await call(new LintHandler(), { action: "lint" }))).toContain("document-too-large");
  });

  it("refuses it at creation too", async () => {
    const result = await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
      sizeExemption: "null",
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("is not a reason");
  });

  it("reports one already written into a corpus", async () => {
    // 2.0.1 stored these, so a corpus can hold them already. The finding has to
    // name what the field actually says, or it reads as the empty case.
    await fs.writeFile(
      path.join(docsDir, DRAFT_DIR, "stored.md"),
      `---\ndescription: a doc\nwhenToUse:\n  - testing\nsizeExemption: "null"\n---\n\n# Stored\n\n${LONG}\n`,
      "utf-8"
    );
    context.reader.invalidateCache();

    const lint = text(await call(new LintHandler(), { action: "lint" }));

    expect(lint).toContain("size-exemption-without-reason");
    expect(lint).toContain('set to "null"');
    // And it is not treated as an exemption, so the size finding stands.
    expect(lint).toContain("document-too-large");
  });
});

/**
 * The id in an example call has to be an id.
 *
 * `lint` labels a draft `<id> (draft)` so the two sets can be told apart. Once
 * these messages began naming the call that answers them, the label went into
 * the call: every size finding on a draft offered `id: "big (draft)"`, which no
 * action accepts. Introduced in 2.0.1 by the same change that added the field.
 */
describe("the call a finding names", () => {
  it("uses the plain id, not the draft label", async () => {
    await call(new AddHandler(), {
      action: "add", id: "big", content: `# Big\n\n${LONG}`,
      description: "a long document", whenToUse: ["testing"],
    });

    const lint = text(await call(new LintHandler(), { action: "lint" }));

    // The label is still there, because a reader needs to know which set it is in.
    expect(lint).toContain("**big (draft)**");
    // The call is not.
    expect(lint).toContain('instruction(action: "update", id: "big", sizeExemption:');
    expect(lint).not.toContain('id: "big (draft)"');
  });

  it("names a removal that works, for a document within the limit", async () => {
    await call(new AddHandler(), {
      action: "add", id: "big", content: "# Big\n\nshort",
      description: "a doc", whenToUse: ["testing"],
      sizeExemption: "Deliberately whole.",
    });

    const lint = text(await call(new LintHandler(), { action: "lint" }));

    expect(lint).toContain("stale-size-exemption");
    expect(lint).not.toContain('id: "big (draft)"');
  });
});
