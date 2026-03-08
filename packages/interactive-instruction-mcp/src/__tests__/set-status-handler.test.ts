import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SetStatusHandler } from "../tools/draft/handlers/set-status-handler.js";
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
        actionParams: { id: "test-doc", status: "editing" },
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
        actionParams: { id: "test-doc", status: "self_review" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("editing → self_review");

      const content = readDraft("test-doc");
      expect(content).toContain("status: self_review");
      expect(content).not.toContain("status: editing");
    });

    it("should return error for missing status parameter", async () => {
      createDraft("test-doc", `---
description: Test
---

# Test`);

      const result = await handler.execute({
        actionParams: { id: "test-doc" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("status is required");
    });

    it("should return error for invalid status value", async () => {
      const result = await handler.execute({
        // @ts-expect-error - testing invalid status value
        actionParams: { id: "test-doc", status: "invalid" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid status");
    });

    it("should return error when draft not found", async () => {
      const result = await handler.execute({
        actionParams: { id: "nonexistent", status: "editing" },
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
        actionParams: { ids: "doc1,doc2,doc3", status: "pending_approval" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("3 succeeded");

      expect(readDraft("doc1")).toContain("status: pending_approval");
      expect(readDraft("doc2")).toContain("status: pending_approval");
      expect(readDraft("doc3")).toContain("status: pending_approval");
    });

    it("should handle mixed success and failure in batch", async () => {
      createDraft("existing", `---
description: Existing
status: editing
---

# Existing`);

      const result = await handler.execute({
        actionParams: { ids: "existing,nonexistent", status: "self_review" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("1 succeeded");
      expect(result.content[0].text).toContain("1 failed");
      expect(result.content[0].text).toContain("existing: editing → self_review");
      expect(result.content[0].text).toContain("nonexistent: not found");
    });

    it("should handle empty ids string", async () => {
      const result = await handler.execute({
        actionParams: { ids: "", status: "editing" },
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
        actionParams: { ids: "doc1 , doc2 , ", status: "editing" },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("2 succeeded");
    });
  });

  describe("all valid statuses", () => {
    const validStatuses = ["editing", "self_review", "user_reviewing", "pending_approval"] as const;

    for (const status of validStatuses) {
      it(`should accept status: ${status}`, async () => {
        createDraft("test-doc", `---
description: Test
---

# Test`);

        const result = await handler.execute({
          actionParams: { id: "test-doc", status },
          context: { reader, config: { reminderEnabled: false } },
        });

        expect(result.isError).toBeFalsy();
        expect(readDraft("test-doc")).toContain(`status: ${status}`);
      });
    }
  });
});
