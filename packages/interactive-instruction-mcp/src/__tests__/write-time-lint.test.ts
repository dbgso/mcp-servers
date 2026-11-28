/**
 * What a write says back about what it just wrote.
 *
 * `lint` is a separate call, and nobody makes it until something else prompts
 * them to -- by which time the document has been approved and whoever could
 * explain its shape has moved on. So `add` and `update` report the
 * document-local rules at the moment they write. What each rule decides is
 * covered in `document-lint.test.ts`; these cases are about the report
 * reaching the response, and about the write succeeding regardless.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const first = result.content[0];
  return first.type === "text" ? (first.text ?? "") : "";
}

function body(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `Line ${i + 1}.`).join("\n");
}

describe("lint at write time", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let addHandler: AddHandler;
  let updateHandler: UpdateHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-time-lint-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });

    reader = new MarkdownReader(docsDir);
    addHandler = new AddHandler();
    updateHandler = new UpdateHandler();

    process.env.IIMCP_LINT_MAX_LINES = "20";
  });

  afterEach(async () => {
    delete process.env.IIMCP_LINT_MAX_LINES;
    await draftWorkflowManager.delete({ id: "big-doc" }).catch(() => {});
    await draftWorkflowManager.delete({ id: "small-doc" }).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function add(params: { id: string; content: string }) {
    return addHandler.execute({
      rawParams: {
        action: "add",
        id: params.id,
        content: params.content,
        description: "A document written for this test",
        whenToUse: ["When testing write-time lint"],
      },
      context: { reader },
    });
  }

  it("reports the document's own issues on add", async () => {
    const result = await add({ id: "big-doc", content: body(50) });

    const text = textOf(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("## Lint (1)");
    expect(text).toContain("document-too-large");
  });

  it("still writes the document it warned about", async () => {
    // A warning is not a gate. Refusing the write would make the author drop
    // the paragraph rather than argue with the tool, which is the outcome
    // `sizeExemption` exists to avoid.
    await add({ id: "big-doc", content: body(50) });

    const saved = await reader.getDocumentContent(`${DRAFT_PREFIX}big-doc`);
    expect(saved).toContain("Line 50.");
  });

  it("says nothing about a sound document", async () => {
    const result = await add({ id: "small-doc", content: "# Title\n\nOne topic." });

    expect(textOf(result)).not.toContain("## Lint");
  });

  it("reports on a draft update, so a document that grew is caught", async () => {
    // `add` alone would miss exactly the documents that grew into the warning.
    await add({ id: "small-doc", content: "# Title\n\nOne topic." });

    const result = await updateHandler.execute({
      rawParams: { action: "update", id: "small-doc", content: body(50) },
      context: { reader },
    });

    const text = textOf(result);
    expect(text).toContain("updated successfully");
    expect(text).toContain("document-too-large");
  });

  it("stops reporting once the update fixes it", async () => {
    await add({ id: "big-doc", content: body(50) });

    const result = await updateHandler.execute({
      rawParams: { action: "update", id: "big-doc", content: "# Title\n\nSplit out." },
      context: { reader },
    });

    expect(textOf(result)).not.toContain("## Lint");
  });

  it("honours the threshold the environment sets", async () => {
    process.env.IIMCP_LINT_MAX_LINES = "200";

    const result = await add({ id: "big-doc", content: body(50) });

    expect(textOf(result)).not.toContain("## Lint");
  });
});
