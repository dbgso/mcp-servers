import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
import { LinkRemoveHandler } from "../tools/instruction/handlers/link-remove.js";
import { resetLinkDeliberationForTesting } from "../tools/instruction/handlers/link-shared.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// The approval module is spied on (not stubbed) in vitest-setup.ts. This file
// used to stub `validateApproval` to `{ valid: true }`, which meant the link
// approval gate was never actually run here.

import { requestApproval, validateApproval } from "mcp-shared/approval";

describe("LinkHandler", () => {
  let addHandler: LinkAddHandler;
  let removeHandler: LinkRemoveHandler;
  let reader: MarkdownReader;
  let tempDir: string;
  let docsDir: string;

  beforeEach(() => {
    resetLinkDeliberationForTesting();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "link-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    addHandler = new LinkAddHandler();
    removeHandler = new LinkRemoveHandler();
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
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
          id: "doc-b",
          relatedDocs: ["doc-a"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Warning: Circular reference detected");
      expect(text).toContain("doc-b -> doc-a -> doc-b");
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

      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
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
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
          id: "doc-a",
          relatedDocs: ["doc-b", "doc-c"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Warning: Circular reference detected");
      expect(text).toContain("doc-a -> doc-b -> doc-a");
      expect(text).toContain("doc-a -> doc-c -> doc-a");
    });

    it("should warn on self-reference", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      // Try to add doc-a to its own relatedDocs
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
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
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
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
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
          id: "doc-a",
          relatedDocs: ["doc-b", "doc-c"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      // Should warn about doc-b
      expect(text).toContain("Warning: Circular reference detected");
      expect(text).toContain("doc-a -> doc-b -> doc-a");
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
      const result = await removeHandler.execute({
        rawParams: {
          action: "link_remove",
          explanation: "Relating these two documents.",
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
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
          relatedDocs: ["doc-b"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Required");
    });

    it("should return error when relatedDocs is missing", async () => {
      createDoc("doc-a", `---
description: Document A
---

# Doc A`);

      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
          id: "doc-a",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Required");
    });

    it("should return error when document does not exist", async () => {
      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
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

      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          explanation: "Relating these two documents.",
          id: "doc-a",
          relatedDocs: ["nonexistent"],
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("do not exist");
    });
  });

  describe("the deliberation gate", () => {
    const explanation = "Doc A now points at Doc B so the overview leads there.";

    const call = (handler: typeof addHandler, rawParams: Record<string, unknown>) =>
      handler.execute({
        rawParams,
        context: { reader, config: { reminderEnabled: false } },
      });

    const addOnce = (over: Record<string, unknown> = {}) =>
      call(addHandler, {
        action: "link_add",
        id: "doc-a",
        relatedDocs: ["doc-b"],
        explanation,
        ...over,
      });

    beforeEach(() => {
      createDoc("doc-a", `---\ndescription: Document A\n---\n\n# Doc A`);
      createDoc("doc-b", `---\ndescription: Document B\n---\n\n# Doc B`);
    });

    it("refuses the first attempt, and says what would change", async () => {
      const result = await addOnce();

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      // The preview is not a step of its own any more: seeing the change and
      // being asked to explain it are the same moment.
      expect(text).toContain("Preview: Adding relatedDocs");
      expect(text).toContain("Not Yet -- Tell the User First");

      const onDisk = fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8");
      expect(onDisk).not.toContain("doc-b");
    });

    it("writes on the second identical attempt", async () => {
      await addOnce();
      const result = await addOnce();

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text as string).toContain("Successfully added relatedDocs");
      expect(fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8")).toContain("doc-b");
    });

    it("takes two calls rather than three", async () => {
      // The token round is gone. What used to be preview -> confirmed ->
      // approvalToken is preview+refusal -> apply.
      await addOnce();
      await addOnce();

      expect(requestApproval).not.toHaveBeenCalled();
    });

    it("starts over when the explanation is reworded", async () => {
      // Committing to one account of the change is the whole signal; retrying
      // with altered arguments is the reflex it is meant to catch.
      await addOnce();
      const result = await addOnce({ explanation: "Same thing, said differently." });

      expect(result.content[0].text as string).toContain("Not Yet");
      expect(fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8")).not.toContain("doc-b");
    });

    it("starts over when the links themselves change", async () => {
      createDoc("doc-c", `---\ndescription: Document C\n---\n\n# Doc C`);

      await addOnce();
      const result = await addOnce({ relatedDocs: ["doc-c"] });

      expect(result.content[0].text as string).toContain("Not Yet");
    });

    it("does not let one document's run carry another's", async () => {
      createDoc("doc-c", `---\ndescription: Document C\n---\n\n# Doc C`);

      // Interleaved, which is how an agent relating several documents works --
      // and what a single-slot gate could never let finish.
      await addOnce();
      await addOnce({ id: "doc-c" });
      await addOnce();

      expect(fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8")).toContain("doc-b");
      expect(fs.readFileSync(path.join(docsDir, "doc-c.md"), "utf-8")).not.toContain("doc-b");
    });

    it("gates link_remove the same way", async () => {
      createDoc("doc-a", `---\ndescription: Document A\nrelatedDocs:\n  - doc-b\n---\n\n# Doc A`);
      const removal = () => call(removeHandler, {
        action: "link_remove",
        id: "doc-a",
        relatedDocs: ["doc-b"],
        explanation: "Doc A no longer leads to Doc B.",
      });

      const first = await removal();
      expect(first.content[0].text as string).toContain("Preview: Removing relatedDocs");
      expect(fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8")).toContain("doc-b");

      await removal();
      expect(fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8")).not.toContain("doc-b");
    });

    it("will not let an add run be finished by a remove", async () => {
      // Same document, same explanation, opposite operations. They hash apart
      // because the action is part of what the run is keyed on.
      createDoc("doc-a", `---\ndescription: Document A\nrelatedDocs:\n  - doc-b\n---\n\n# Doc A`);

      await call(addHandler, {
        action: "link_add", id: "doc-a", relatedDocs: ["doc-b"], explanation,
      });
      const result = await call(removeHandler, {
        action: "link_remove", id: "doc-a", relatedDocs: ["doc-b"], explanation,
      });

      expect(result.content[0].text as string).toContain("Not Yet");
      expect(fs.readFileSync(path.join(docsDir, "doc-a.md"), "utf-8")).toContain("doc-b");
    });

    it("refuses a change that names a document that does not exist", async () => {
      // Checked before the gate: making the caller explain a change that
      // cannot happen wastes the one thing the gate is spending.
      const result = await addOnce({ relatedDocs: ["ghost"] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text as string).toContain("do not exist");
    });
  });

  describe("changes that need no gate", () => {
    it("says nothing changed when every link is already there", async () => {
      createDoc("doc-a", `---\ndescription: Document A\nrelatedDocs:\n  - doc-b\n---\n\n# Doc A`);
      createDoc("doc-b", `---\ndescription: Document B\n---\n\n# Doc B`);

      const result = await addHandler.execute({
        rawParams: {
          action: "link_add",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          explanation: "Nothing to do.",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text as string).toContain("already in relatedDocs");
    });

    it("says nothing changed when the links to remove are not there", async () => {
      createDoc("doc-a", `---\ndescription: Document A\nrelatedDocs:\n  - doc-c\n---\n\n# Doc A`);
      createDoc("doc-b", `---\ndescription: Document B\n---\n\n# Doc B`);

      const result = await removeHandler.execute({
        rawParams: {
          action: "link_remove",
          id: "doc-a",
          relatedDocs: ["doc-b"],
          explanation: "Nothing to do.",
        },
        context: { reader, config: { reminderEnabled: false } },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text as string).toContain("None of the specified documents are in relatedDocs");
    });
  });
});
