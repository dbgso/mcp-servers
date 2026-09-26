import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { RenameHandler } from "../tools/instruction/handlers/rename.js";
import { MarkdownReader } from "../services/markdown-reader.js";

import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";

describe("RenameHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let draftsDir: string;
  let reader: MarkdownReader;
  let handler: RenameHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rename-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    draftsDir = path.join(docsDir, "_mcp_drafts");
    await fs.mkdir(draftsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new RenameHandler();

    // A gate is process memory, so a run started by one case would otherwise
    // let the next one through on its first attempt.
    resetMutationGatesForTesting();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("validation", () => {
    it("requires id parameter", async () => {
      const result = await handler.execute({
        rawParams: { action: "rename", newId: "new-name" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Required");
    });

    it("requires newId parameter", async () => {
      const result = await handler.execute({
        rawParams: { action: "rename", id: "old-name" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Required");
    });

    it("returns error when document not found", async () => {
      const result = await handler.execute({
        rawParams: { action: "rename", id: "nonexistent", newId: "new-name" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("not found");
    });
  });

  describe("draft rename", () => {
    it("renames draft without approval", async () => {
      const content = `---
description: A draft document
---

# Draft Doc

Content.`;
      await fs.writeFile(path.join(draftsDir, "old-draft.md"), content);

      const result = await handler.execute({
        rawParams: { action: "rename", id: "old-draft", newId: "new-draft" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("renamed");
      expect(text).toContain("old-draft");
      expect(text).toContain("new-draft");

      // Verify file was renamed
      const oldExists = await fs.access(path.join(draftsDir, "old-draft.md")).then(() => true).catch(() => false);
      const newExists = await fs.access(path.join(draftsDir, "new-draft.md")).then(() => true).catch(() => false);
      expect(oldExists).toBe(false);
      expect(newExists).toBe(true);
    });

    it("returns error when draft rename fails", async () => {
      // Try to rename to a path that already exists
      const content1 = `# Draft 1\n\nContent.`;
      const content2 = `# Draft 2\n\nContent.`;
      await fs.writeFile(path.join(draftsDir, "draft-1.md"), content1);
      await fs.writeFile(path.join(draftsDir, "draft-2.md"), content2);

      const result = await handler.execute({
        rawParams: { action: "rename", id: "draft-1", newId: "draft-2" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("promoted document rename", () => {
    const promoted = `---
description: A promoted document
---

# Promoted Doc

Content.`;

    const rename = (params: { id: string; newId: string; explanation?: string }) =>
      handler.execute({
        rawParams: {
          action: "rename",
          id: params.id,
          newId: params.newId,
          ...(params.explanation === undefined ? {} : { explanation: params.explanation }),
        },
        context: { reader },
      });

    it("asks for an explanation before anything else", async () => {
      await fs.writeFile(path.join(docsDir, "promoted-doc.md"), promoted);

      const result = await rename({ id: "promoted-doc", newId: "new-promoted" });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("explanation");
      // Nothing moved.
      expect(await reader.documentExists("promoted-doc")).toBe(true);
    });

    it("refuses the first attempt and says what will be edited", async () => {
      await fs.writeFile(path.join(docsDir, "main-doc.md"), promoted);
      await fs.writeFile(
        path.join(docsDir, "ref-doc.md"),
        `---\ndescription: References main doc\nrelatedDocs:\n  - main-doc\n---\n\n# Referencing Doc`
      );

      const result = await rename({ id: "main-doc", newId: "renamed-doc", explanation: "splitting the hub" });

      expect(isRefusal(result)).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // The backlink preview rides on the refusal instead of being a step of
      // its own, so the caller sees the damage while being asked to explain it.
      expect(text).toContain("ref-doc");
      expect(text).toContain("main-doc");
      expect(text).toContain("renamed-doc");
      expect(await reader.documentExists("main-doc")).toBe(true);
    });

    it("renames once the identical call is repeated", async () => {
      await fs.writeFile(path.join(docsDir, "promoted-doc.md"), promoted);

      const { response, attempts } = await throughGate(() =>
        rename({ id: "promoted-doc", newId: "new-promoted", explanation: "clearer name" })
      );

      expect(response.isError).toBeFalsy();
      expect(attempts).toBeGreaterThan(1);
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      expect(text).toContain("Successfully renamed");

      expect(await reader.documentExists("promoted-doc")).toBe(false);
      expect(await reader.documentExists("new-promoted")).toBe(true);
    });

    it("does not accept a reworded explanation as a repeat", async () => {
      await fs.writeFile(path.join(docsDir, "promoted-doc.md"), promoted);

      // The reflex on being refused is to retry with altered arguments, and
      // that is exactly what must not get through: the wording is part of the
      // key, so this is a new run every time.
      for (const explanation of ["reason one", "reason two", "reason three", "reason four"]) {
        const result = await rename({ id: "promoted-doc", newId: "new-promoted", explanation });
        expect(isRefusal(result)).toBe(true);
      }

      expect(await reader.documentExists("promoted-doc")).toBe(true);
    });

    it("updates backlinks when it goes through", async () => {
      await fs.writeFile(path.join(docsDir, "main-doc.md"), promoted);
      await fs.writeFile(
        path.join(docsDir, "ref-doc.md"),
        `---\ndescription: References main doc\nrelatedDocs:\n  - main-doc\n---\n\n# Referencing Doc`
      );

      const { response } = await throughGate(() =>
        rename({ id: "main-doc", newId: "renamed-doc", explanation: "renaming the hub" })
      );
      expect(response.isError).toBeFalsy();

      const updatedRefContent = await fs.readFile(path.join(docsDir, "ref-doc.md"), "utf-8");
      expect(updatedRefContent).toContain("relatedDocs:");
      expect(updatedRefContent).toContain("renamed-doc");
    });

    it("refuses a destination that is already taken, before the run starts", async () => {
      await fs.writeFile(path.join(docsDir, "one.md"), promoted);
      await fs.writeFile(path.join(docsDir, "two.md"), promoted);

      const result = await rename({ id: "one", newId: "two", explanation: "merging them" });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("already exists");
    });

    it("leaves the run standing when the rename itself fails", async () => {
      await fs.writeFile(path.join(docsDir, "doomed.md"), promoted);

      const explanation = "the old name is wrong";
      const call = () => rename({ id: "doomed", newId: "doomed-renamed", explanation });

      // Get to the attempt that would write, then make the write fail.
      // The spy goes in before every attempt: which attempt reaches the write
      // depends on the configured count, not on this test.
      let response;
      do {
        const renameSpy = vi
          .spyOn(reader, "renameDocument")
          .mockResolvedValue({ success: false, error: "simulated disk failure" });
        response = await call();
        renameSpy.mockRestore();
      } while (isRefusal(response));

      expect(response.isError).toBe(true);
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      expect(text).toContain("simulated disk failure");
      expect(await reader.getDocumentContent("doomed")).toContain("Promoted Doc");

      // The user has heard the explanation once already, so the next identical
      // call writes rather than asking for it again.
      const retry = await call();
      expect(retry.isError).toBeFalsy();
      expect(await reader.documentExists("doomed-renamed")).toBe(true);
    });
  });
});
