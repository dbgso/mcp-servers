import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { UpdateMetaHandler } from "../tools/instruction/handlers/update-meta.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig } from "../types/index.js";
import type { InstructionContext } from "../tools/instruction/types.js";

describe("UpdateMetaHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: UpdateMetaHandler;
  let context: InstructionContext;

  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-meta-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new UpdateMetaHandler();
    context = { reader, config: defaultConfig };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns error for non-existent document", async () => {
    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "nonexistent" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("shows what the metadata says now", async () => {
    const content = `---
description: Original description
whenToUse:
  - Use case 1
  - Use case 2
---

# Test Document

Some content here.`;
    await fs.writeFile(path.join(docsDir, "test-doc.md"), content);

    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "test-doc" },
      context,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text as string;

    expect(text).toContain("test-doc");
    expect(text).toContain("Original description");
    expect(text).toContain("Use case 1");
    expect(text).toContain("Use case 2");
  });

  it("does not repeat the whole document back", async () => {
    // The body is what `read` is for. Returning it here made the response
    // large for no gain, and the metadata is what is under review.
    const content = `---
description: A doc
---

# Test Document

A distinctive sentence that only appears in the body.`;
    await fs.writeFile(path.join(docsDir, "test-doc.md"), content);

    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "test-doc" },
      context,
    });

    expect(result.content[0].text).not.toContain("A distinctive sentence");
  });

  it("says which fields are unset", async () => {
    await fs.writeFile(
      path.join(docsDir, "no-meta.md"),
      "# No Metadata\n\nJust content without frontmatter."
    );

    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "no-meta" },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("(not set)");
  });

  it("asks for the metadata on its own, not a whole-document update", async () => {
    await fs.writeFile(path.join(docsDir, "doc.md"), "---\ndescription: Test\n---\n\n# Doc");

    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "doc" },
      context,
    });

    const text = result.content[0].text as string;

    // Pointing at a full-content `update` is what made callers resend documents
    // they were not editing.
    expect(text).toContain('description: "..."');
    expect(text).not.toContain("content:");
  });

  describe("where the document sits", () => {
    // `__` is the hierarchy separator, so an id maps onto directories.
    const write = async (id: string, frontmatter: string) => {
      const file = path.join(docsDir, `${id.split("__").join(path.sep)}.md`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `---\n${frontmatter}\n---\n\n# ${id}`);
      reader.invalidateCache();
    };

    it("lists the documents one hop away", async () => {
      await write("cat__hub", "description: The hub\nrelatedDocs:\n  - cat__detail");
      await write("cat__detail", "description: The detail");

      const result = await handler.execute({
        rawParams: { action: "update_meta", id: "cat__detail" },
        context,
      });

      const text = result.content[0].text as string;
      expect(text).toContain("What it sits next to");
      expect(text).toContain("cat__hub");
      expect(text).toContain("The hub");
    });

    it("offers same-category candidates when nothing links to it", async () => {
      await write("cat__lonely", "description: Alone");
      await write("cat__sibling", "description: A sibling");
      await write("other__unrelated", "description: Elsewhere");

      const result = await handler.execute({
        rawParams: { action: "update_meta", id: "cat__lonely" },
        context,
      });

      const text = result.content[0].text as string;
      expect(text).toContain("Where it might belong");
      expect(text).toContain("cat__sibling");
      // A different category says nothing about where this one belongs.
      expect(text).not.toContain("other__unrelated");
    });

    it("explains the direction links run in, but only when there are none", async () => {
      await write("cat__lonely", "description: Alone");
      await write("cat__sibling", "description: A sibling");

      const lonely = await handler.execute({
        rawParams: { action: "update_meta", id: "cat__lonely" },
        context,
      });
      expect(lonely.content[0].text).toContain("Links run one way");

      await write("cat__hub", "description: The hub\nrelatedDocs:\n  - cat__lonely");
      reader.invalidateCache();

      const linked = await handler.execute({
        rawParams: { action: "update_meta", id: "cat__lonely" },
        context,
      });
      expect(linked.content[0].text).not.toContain("Links run one way");
    });

    it("says so when the document has no neighbours and no category peers", async () => {
      await write("solo", "description: Only one");

      const result = await handler.execute({
        rawParams: { action: "update_meta", id: "solo" },
        context,
      });

      expect(result.content[0].text).toContain("nothing else shares its category");
    });
  });
});