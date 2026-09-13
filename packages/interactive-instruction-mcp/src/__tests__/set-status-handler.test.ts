import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SetStatusHandler } from "../tools/instruction/handlers/set-status.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("SetStatusHandler", () => {
  let handler: SetStatusHandler;
  let reader: MarkdownReader;
  let tempDir: string;
  let docsDir: string;
  let draftsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "set-status-test-"));
    docsDir = path.join(tempDir, "docs");
    draftsDir = path.join(tempDir, "docs", "_mcp_drafts");
    fs.mkdirSync(draftsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new SetStatusHandler();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createDraft = (id: string, content: string) => {
    const filePath = path.join(draftsDir, `${id}.md`);
    fs.writeFileSync(filePath, content, "utf-8");
  };

  const readDraft = (id: string): string => {
    const filePath = path.join(draftsDir, `${id}.md`);
    return fs.readFileSync(filePath, "utf-8");
  };

  describe("single draft status update", () => {
    it("should set status on a draft without existing status", async () => {
      createDraft("test-doc", `---
description: Test document
whenToUse:
  - Testing
---

# Test

Content`);

      const result = await handler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Status updated");

      const content = readDraft("test-doc");
      expect(content).toContain("status: editing");
    });

    it("should update existing status", async () => {
      createDraft("test-doc", `---
description: Test document
status: editing
---

# Test`);

      const result = await handler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("editing -> editing");

      const content = readDraft("test-doc");
      expect(content).toContain("status: editing");
      expect(content).not.toContain("status: self_review");
    });

    it("should return error for missing status parameter", async () => {
      createDraft("test-doc", `---
description: Test
---

# Test`);

      const result = await handler.execute({
        rawParams: { action: "set_status", id: "test-doc" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      // The help travels with every schema rejection, so a caller that gets the
      // parameter wrong is told what the action is actually for.
      expect(result.content[0].text).toContain("Only \"editing\" can be set");
    });

    it.each([
      ["a state that does not exist", "invalid"],
      ["a real workflow state", "pending_approval"],
    ])("rejects %s at the schema, not at call time", async (_label, status) => {
      const result = await handler.execute({
        // @ts-expect-error - testing a status the schema does not accept
        rawParams: { action: "set_status", id: "test-doc", status },
        context: { reader, config: { reminderEnabled: false } },
      });

      // The schema is what the agent is shown. Advertising the later workflow
      // states and refusing them at call time would keep offering an option
      // that can never work.
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("invalid_literal");
    });

    it("should return error when draft not found", async () => {
      const result = await handler.execute({
        rawParams: { action: "set_status", id: "nonexistent", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy(); // Not an error, just reports in results
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("batch status update", () => {
    it("should update multiple drafts with ids parameter", async () => {
      createDraft("doc1", `---
description: Doc 1
status: editing
---

# Doc 1`);

      createDraft("doc2", `---
description: Doc 2
status: self_review
---

# Doc 2`);

      createDraft("doc3", `---
description: Doc 3
---

# Doc 3`);

      const result = await handler.execute({
        rawParams: { action: "set_status", ids: "doc1,doc2,doc3", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("3 succeeded");

      expect(readDraft("doc1")).toContain("status: editing");
      expect(readDraft("doc2")).toContain("status: editing");
      expect(readDraft("doc3")).toContain("status: editing");
    });

    it("should handle mixed success and failure in batch", async () => {
      createDraft("existing", `---
description: Existing
status: editing
---

# Existing`);

      const result = await handler.execute({
        rawParams: { action: "set_status", ids: "existing,nonexistent", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("1 succeeded");
      expect(result.content[0].text).toContain("1 failed");
      expect(result.content[0].text).toContain("existing: editing -> editing");
      expect(result.content[0].text).toContain("nonexistent: not found");
    });

    it("should handle empty ids string", async () => {
      const result = await handler.execute({
        rawParams: { action: "set_status", ids: "", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("id or ids is required");
    });

    it("should handle whitespace in ids", async () => {
      createDraft("doc1", `---
description: Doc 1
---

# Doc 1`);

      createDraft("doc2", `---
description: Doc 2
---

# Doc 2`);

      const result = await handler.execute({
        rawParams: { action: "set_status", ids: "doc1 , doc2 , ", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("2 succeeded");
    });
  });

  describe("only a reset is accepted", () => {
    it("accepts status: editing", async () => {
      createDraft("test-doc", `---
description: Test
---

# Test`);

      const result = await handler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(readDraft("test-doc")).toContain("status: editing");
    });

    // Writing a later state here only ever changed the frontmatter, which
    // nothing reads -- the approve handler goes by the workflow manager. The
    // document and the state machine ended up disagreeing and nothing advanced.
    for (const status of ["self_review", "user_reviewing", "pending_approval"] as const) {
      it(`refuses to declare status: ${status}`, async () => {
        createDraft("test-doc", `---
description: Test
---

# Test`);

        const result = await handler.execute({
          rawParams: { action: "set_status", id: "test-doc", status },
          context: { reader, config: { reminderEnabled: false } },
        });

        expect(result.isError).toBe(true);
        expect(readDraft("test-doc")).not.toContain(`status: ${status}`);
      });
    }
  });

  describe("error handling", () => {
    it("should handle updateDocument failure in batch (lines 106-107)", async () => {
      createDraft("doc1", `---
description: Doc 1
---

# Doc 1`);

      createDraft("doc2", `---
description: Doc 2
---

# Doc 2`);

      // Mock updateDocument to fail for second document
      const updateSpy = vi.spyOn(reader, "updateDocument");
      updateSpy.mockResolvedValueOnce({ success: true }); // First doc succeeds
      updateSpy.mockResolvedValueOnce({ success: false, error: "Permission denied" }); // Second doc fails

      const result = await handler.execute({
        rawParams: { action: "set_status", ids: "doc1,doc2", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("1 succeeded");
      expect(text).toContain("1 failed");
      expect(text).toContain("Permission denied");

      updateSpy.mockRestore();
    });
  });
});
