import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ApplyHandler } from "../tools/instruction/handlers/apply.js";
import { CancelHandler } from "../tools/instruction/handlers/cancel.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { savePendingUpdate, getPendingUpdate, deletePendingUpdate } from "../utils/pending-update.js";

describe("ApplyHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: ApplyHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new ApplyHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("requires id", async () => {
    const result = await handler.execute({
      rawParams: { action: "apply" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "Required"
    );
  });

  it("returns error when no pending update exists", async () => {
    const result = await handler.execute({
      rawParams: { action: "apply", id: "nonexistent", explanation: "test: applies the staged update" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "No pending update found"
    );
  });

  it("applies pending update to file", async () => {
    // Create original file
    const originalPath = path.join(docsDir, "test-doc.md");
    await fs.writeFile(originalPath, "# Original\n\nOld content.");

    // Create pending update
    const diffPath = path.join(tempDir, "test.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      docsDir,
      id: "test-doc",
      content: "# Updated\n\nNew content.",
      originalContent: "# Original\n\nOld content.",
      originalPath,
      diffPath,
    });

    // Apply
    // The first attempt is refused by design; the second identical one applies.
    await handler.execute({
      rawParams: { action: "apply", id: "test-doc", explanation: "test: applies the staged update" },
      context: { reader },
    });
    const result = await handler.execute({
      rawParams: { action: "apply", id: "test-doc", explanation: "test: applies the staged update" },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "Update applied successfully"
    );

    // Verify file was updated
    const content = await fs.readFile(originalPath, "utf-8");
    expect(content).toContain("New content");

    // Verify pending was cleaned up
    const pending = await getPendingUpdate({ docsDir, id: "test-doc" });
    expect(pending).toBeNull();
  });

  it("discards a pending update whose document is gone instead of recreating it", async () => {
    // The document was deleted after the update was staged -- and deleting a
    // promoted document takes an approval token. `apply` used to write
    // `pending.content` to the stored path regardless, which brought the
    // document back without any approval.
    const diffPath = path.join(tempDir, "test.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      docsDir,
      id: "deleted-doc",
      content: "# Resurrected",
      originalContent: "# Original",
      originalPath: path.join(docsDir, "deleted-doc.md"),
      diffPath,
    });

    const result = await handler.execute({
      rawParams: { action: "apply", id: "deleted-doc", explanation: "test: applies the staged update" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "no longer exists"
    );
    await expect(fs.access(path.join(docsDir, "deleted-doc.md"))).rejects.toThrow();
    expect(await getPendingUpdate({ docsDir, id: "deleted-doc" })).toBeNull();
  });

  it("does not leave a stale description in the list cache", async () => {
    const originalPath = path.join(docsDir, "cached.md");
    const originalContent = "---\ndescription: OLD DESC\n---\n\n# Cached";
    await fs.writeFile(originalPath, originalContent);

    // Populate the cache the way a `list` call would.
    await reader.listDocuments({ recursive: true });

    const diffPath = path.join(tempDir, "cached.diff");
    await fs.writeFile(diffPath, "diff content");
    await savePendingUpdate({
      docsDir,
      id: "cached",
      content: "---\ndescription: NEW DESC\n---\n\n# Cached",
      originalContent,
      originalPath,
      diffPath,
    });

    // The first attempt is refused by design; the second identical one applies.
    await handler.execute({
      rawParams: { action: "apply", id: "cached", explanation: "test: applies the staged update" },
      context: { reader },
    });
    await handler.execute({ rawParams: { action: "apply", id: "cached", explanation: "test: applies the staged update" }, context: { reader } });

    // `apply` used to write through raw fs, bypassing the reader, so every
    // other write path invalidated the cache and this one did not -- `list`
    // served the old description for up to the full TTL.
    const listed = await reader.listDocuments({ recursive: true });
    const doc = listed.documents.find((d) => d.id === "cached");
    expect(doc?.description).toBe("NEW DESC");
  });

  // The gate is a process-wide single slot, so each test here uses its own
  // document id: a run left behind by one test would otherwise prime the next.
  describe("the deliberation gate", () => {
    async function stage(id: string): Promise<void> {
      const originalPath = path.join(docsDir, `${id}.md`);
      const originalContent = `# ${id}\n\nv1`;
      await fs.writeFile(originalPath, originalContent);
      const diffPath = path.join(tempDir, `${id}.diff`);
      await fs.writeFile(diffPath, "diff content");
      await savePendingUpdate({
        docsDir,
        id,
        content: `# ${id}\n\nv2`,
        originalContent,
        originalPath,
        diffPath,
      });
    }

    const apply = (id: string, explanation: string) =>
      handler.execute({
        rawParams: { action: "apply", id, explanation },
        context: { reader },
      });

    it("refuses the first attempt and tells the caller to explain the change", async () => {
      await stage("gated-first");

      const first = await apply("gated-first", "Adds the v2 body we discussed.");

      expect(first.isError).toBe(true);
      const text = first.content[0].type === "text" ? first.content[0].text : "";
      expect(text).toContain("Explain to the user");
      // Refused means refused: nothing was written.
      expect(await fs.readFile(path.join(docsDir, "gated-first.md"), "utf-8")).toContain("v1");
    });

    it("applies on the second identical attempt", async () => {
      await stage("gated-second");
      const explanation = "Adds the v2 body we discussed.";

      await apply("gated-second", explanation);
      const second = await apply("gated-second", explanation);

      expect(second.isError).toBeFalsy();
      expect(await fs.readFile(path.join(docsDir, "gated-second.md"), "utf-8")).toContain("v2");
    });

    it("starts over when the retry reworks its explanation", async () => {
      await stage("gated-reworded");

      await apply("gated-reworded", "Adds the v2 body we discussed.");
      // Retrying with altered arguments is the reflex this gate is built
      // around: a different explanation is a different attempt.
      const second = await apply("gated-reworded", "Updating the document.");

      expect(second.isError).toBe(true);
      expect(await fs.readFile(path.join(docsDir, "gated-reworded.md"), "utf-8")).toContain("v1");
    });

    it("requires the attempts to be consecutive", async () => {
      await stage("one");
      await stage("two");

      await apply("one", "Applies one.");
      await apply("two", "Applies two.");
      const back = await apply("one", "Applies one.");

      expect(back.isError).toBe(true);
      expect(await fs.readFile(path.join(docsDir, "one.md"), "utf-8")).toContain("v1");
    });

    it("rejects a call with no explanation at all", async () => {
      await stage("gated-noexpl");

      const result = await handler.execute({
        // @ts-expect-error - explanation is required
        rawParams: { action: "apply", id: "gated-noexpl" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
    });
  });

  it("refuses when the document changed after the update was prepared", async () => {
    const originalPath = path.join(docsDir, "raced.md");
    await fs.writeFile(originalPath, "# Raced\n\nv1");

    const diffPath = path.join(tempDir, "raced.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      docsDir,
      id: "raced",
      content: "# Raced\n\nv2 from the agent",
      originalContent: "# Raced\n\nv1",
      originalPath,
      diffPath,
    });

    // Someone edits the file by hand in the meantime.
    await fs.writeFile(originalPath, "# Raced\n\nhand-written edit");
    reader.invalidateCache();

    const result = await handler.execute({
      rawParams: { action: "apply", id: "raced", explanation: "test: applies the staged update" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(await fs.readFile(originalPath, "utf-8")).toContain("hand-written edit");
  });

});

describe("CancelHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: CancelHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cancel-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new CancelHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("requires id", async () => {
    const result = await handler.execute({
      rawParams: { action: "cancel" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "Required"
    );
  });

  it("returns error when no pending update exists", async () => {
    const result = await handler.execute({
      rawParams: { action: "cancel", id: "nonexistent" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "No pending update found"
    );
  });

  it("cancels pending update and cleans up", async () => {
    // Create pending update
    const originalPath = path.join(docsDir, "test-doc.md");
    const originalContent = "# Original";
    await fs.writeFile(originalPath, originalContent);
    const diffPath = path.join(tempDir, "test.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      docsDir,
      id: "test-doc",
      content: "# New",
      originalContent,
      originalPath,
      diffPath,
    });

    // Cancel
    const result = await handler.execute({
      rawParams: { action: "cancel", id: "test-doc" },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "cancelled"
    );

    // Verify pending was cleaned up
    const pending = await getPendingUpdate({ docsDir, id: "test-doc" });
    expect(pending).toBeNull();
  });
});

describe("Update → Apply/Cancel integration", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let updateHandler: UpdateHandler;
  let applyHandler: ApplyHandler;
  let cancelHandler: CancelHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-apply-integration-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    updateHandler = new UpdateHandler();
    applyHandler = new ApplyHandler();
    cancelHandler = new CancelHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("update → apply: full flow for existing document", async () => {
    // Step 1: Create existing document
    const docPath = path.join(docsDir, "existing-doc.md");
    await fs.writeFile(docPath, `---
description: Original description
---

# Existing Doc

Original content here.`);

    // Step 2: Call update (creates pending + diff)
    const updateResult = await updateHandler.execute({
      rawParams: {
        action: "update",
        id: "existing-doc",
        content: `---
description: Original description
---

# Existing Doc

Updated content here.`,
      },
      context: { reader },
    });

    expect(updateResult.isError).toBeFalsy();
    const updateText = updateResult.content[0].type === "text" ? updateResult.content[0].text : "";
    expect(updateText).toContain("Update prepared");
    expect(updateText).toContain("```diff");
    expect(updateText).toContain("-Original content here.");
    expect(updateText).toContain("+Updated content here.");

    // Step 3: Call apply
    // The first attempt is refused by design; the second identical one applies.
    await applyHandler.execute({
      rawParams: { action: "apply", id: "existing-doc", explanation: "test: applies the staged update" },
      context: { reader },
    });
    const applyResult = await applyHandler.execute({
      rawParams: { action: "apply", id: "existing-doc", explanation: "test: applies the staged update" },
      context: { reader },
    });

    expect(applyResult.isError).toBeFalsy();
    const applyText = applyResult.content[0].type === "text" ? applyResult.content[0].text : "";
    expect(applyText).toContain("Update applied successfully");

    // Step 4: Verify file was updated
    const finalContent = await fs.readFile(docPath, "utf-8");
    expect(finalContent).toContain("Updated content here.");
    expect(finalContent).not.toContain("Original content here.");
  });

  it("update → cancel: discards changes", async () => {
    // Step 1: Create existing document
    const docPath = path.join(docsDir, "cancel-test.md");
    const originalContent = `---
description: Test doc
---

# Cancel Test

Original content.`;
    await fs.writeFile(docPath, originalContent);

    // Step 2: Call update
    const updateResult = await updateHandler.execute({
      rawParams: {
        action: "update",
        id: "cancel-test",
        content: `---
description: Test doc
---

# Cancel Test

This change will be cancelled.`,
      },
      context: { reader },
    });

    expect(updateResult.isError).toBeFalsy();

    // Step 3: Call cancel
    const cancelResult = await cancelHandler.execute({
      rawParams: { action: "cancel", id: "cancel-test" },
      context: { reader },
    });

    expect(cancelResult.isError).toBeFalsy();
    const cancelText = cancelResult.content[0].type === "text" ? cancelResult.content[0].text : "";
    expect(cancelText).toContain("cancelled");

    // Step 4: Verify file was NOT changed
    const finalContent = await fs.readFile(docPath, "utf-8");
    expect(finalContent).toContain("Original content.");
    expect(finalContent).not.toContain("This change will be cancelled.");
  });
});
