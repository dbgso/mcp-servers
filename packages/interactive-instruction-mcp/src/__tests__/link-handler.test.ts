import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LinkHandler } from "../tools/draft/handlers/link-handler.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the approval functions
vi.mock("mcp-shared", async () => {
  const actual = await vi.importActual("mcp-shared");
  return {
    ...actual,
    requestApproval: vi.fn().mockResolvedValue({ fallbackPath: "/tmp/test" }),
    validateApproval: vi.fn().mockReturnValue({ valid: true }),
  };
});

import { requestApproval, validateApproval } from "mcp-shared";

describe("LinkHandler", () => {
  let handler: LinkHandler;
  let reader: MarkdownReader;
  let tempDir: string;
  let docsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "link-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new LinkHandler();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createDoc = (id: string, content: string) => {
    const filePath = path.join(docsDir, `${id.replace(/__/g, "/")}.md`);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  };

  describe("circular reference detection", () => {
    it("should warn when adding link that creates circular reference", async () => {
      // doc-a already references doc-b
      createDoc("doc-a", `---
description: Document A
relatedDocs:
  - doc-b
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      // Try to add doc-a to doc-b's relatedDocs (would create circular: b -> a -> b)
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-b",
          relatedDocs: ["doc-a"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Warning: Circular reference detected");
      expect(text).toContain("doc-b → doc-a → doc-b");
    });

    it("should not warn when no circular reference", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).not.toContain("Warning");
      expect(text).not.toContain("Circular reference");
    });

    it("should detect multiple circular references", async () => {
      // Both doc-b and doc-c reference doc-a
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
relatedDocs:
  - doc-a
---

# Doc B`);

      createDoc("doc-c", `---
description: Document C
relatedDocs:
  - doc-a
---

# Doc C`);

      // Try to add both doc-b and doc-c to doc-a
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b", "doc-c"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Warning: Circular reference detected");
      expect(text).toContain("doc-a → doc-b → doc-a");
      expect(text).toContain("doc-a → doc-c → doc-a");
    });

    it("should warn on self-reference", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      // Try to add doc-a to its own relatedDocs
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-a"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Warning");
      expect(text).toContain("Self-reference");
    });

    it("should detect deeper chain circular reference (A -> B -> C, add C -> A)", async () => {
      // A -> B -> C chain
      createDoc("doc-a", `---
description: Document A
relatedDocs:
  - doc-b
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
relatedDocs:
  - doc-c
---

# Doc B`);

      createDoc("doc-c", `---
description: Document C
---

# Doc C`);

      // Try to add doc-a to doc-c's relatedDocs (would create: c -> a -> b -> c)
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-c",
          relatedDocs: ["doc-a"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      // Deeper chains should also be detected
      expect(text).toContain("Warning");
      expect(text).toContain("Circular reference");
    });

    it("should warn for some and not others in mixed scenario", async () => {
      // doc-b references doc-a, doc-c does not
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
relatedDocs:
  - doc-a
---

# Doc B`);

      createDoc("doc-c", `---
description: Document C
---

# Doc C`);

      // Add both doc-b (circular) and doc-c (not circular) to doc-a
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b", "doc-c"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      // Should warn about doc-b
      expect(text).toContain("Warning: Circular reference detected");
      expect(text).toContain("doc-a → doc-b → doc-a");
      // But doc-c should still be in the new relatedDocs
      expect(text).toContain("doc-b, doc-c");
    });

    it("should not check circular for link_remove", async () => {
      createDoc("doc-a", `---
description: Document A
relatedDocs:
  - doc-b
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
relatedDocs:
  - doc-a
---

# Doc B`);

      // link_remove should not warn about circular
      const result = await handler.execute({
        actionParams: {
          action: "link_remove",
          id: "doc-a",
          relatedDocs: ["doc-b"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).not.toContain("Warning");
    });
  });

  describe("basic functionality", () => {
    it("should return error when id is missing", async () => {
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          relatedDocs: ["doc-b"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("id is required");
    });

    it("should return error when relatedDocs is missing", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("relatedDocs is required");
    });

    it("should return error when document does not exist", async () => {
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "nonexistent",
          relatedDocs: ["doc-b"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return error when target document does not exist", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["nonexistent"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("do not exist");
    });
  });

  describe("approval flow", () => {
    it("should request approval when confirmed is true", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          confirmed: true,
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Approval Requested");
      expect(requestApproval).toHaveBeenCalled();
    });

    it("should apply link when approval token is valid", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      // First request approval
      await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          confirmed: true,
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      // Then apply with token
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          approvalToken: "test-token",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Successfully added");
      expect(text).toContain("doc-b");

      // Verify file was updated
      const updatedContent = fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8");
      expect(updatedContent).toContain("relatedDocs:");
      expect(updatedContent).toContain("doc-b");
    });

    it("should apply link_remove when approval token is valid", async () => {
      createDoc("doc-a", `---
description: Document A
relatedDocs:
  - doc-b
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      // First request approval
      await handler.execute({
        actionParams: {
          action: "link_remove",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          confirmed: true,
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      // Then apply with token
      const result = await handler.execute({
        actionParams: {
          action: "link_remove",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          approvalToken: "test-token",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Successfully removed");

      // Verify file was updated - relatedDocs should be removed
      const updatedContent = fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8");
      expect(updatedContent).not.toContain("doc-b");
    });

    it("should return no change when removing docs not in relatedDocs", async () => {
      createDoc("doc-a", `---
description: Document A
relatedDocs:
  - doc-c
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      const result = await handler.execute({
        actionParams: {
          action: "link_remove",
          id: "doc-a",
          relatedDocs: ["doc-b"],  // doc-b is not in doc-a's relatedDocs
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("None of the specified documents are in relatedDocs");
    });

    it("should return error when no pending change found for approval", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      // Try to apply token without first requesting approval
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          approvalToken: "some-token",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain("No pending change found");
    });

    it("should return no change when all docs are already in relatedDocs (line 199)", async () => {
      createDoc("doc-a", `---
description: Document A
relatedDocs:
  - doc-b
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      // Try to add doc-b which is already in doc-a's relatedDocs
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("All specified documents are already in relatedDocs");
    });

    it("should return error when approval token is invalid", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      createDoc("doc-b", `---
description: Document B
---

# Doc B`);

      // First request approval
      await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          confirmed: true,
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      // Mock validateApproval to return invalid
      vi.mocked(validateApproval).mockReturnValueOnce({ valid: false, reason: "Token expired" });

      // Then try with invalid token
      const result = await handler.execute({
        actionParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          approvalToken: "invalid-token",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain("Token expired");
    });
  });
});
