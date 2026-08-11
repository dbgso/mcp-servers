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

  it("returns metadata update prompt for existing document", async () => {
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
    const text = result.content[0].text;

    expect(text).toContain("Metadata Update Request");
    expect(text).toContain("test-doc");
    expect(text).toContain("Original description");
    expect(text).toContain("Use case 1");
    expect(text).toContain("Use case 2");
    expect(text).toContain("Document Content");
    expect(text).toContain("Test Document");
  });

  it("handles document without metadata", async () => {
    const content = `# No Metadata

Just content without frontmatter.`;
    await fs.writeFile(path.join(docsDir, "no-meta.md"), content);

    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "no-meta" },
      context,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;

    expect(text).toContain("(Not set)");
    expect(text).toContain("No Metadata");
  });

  it("includes instructions for updating metadata", async () => {
    const content = `---
description: Test
---

# Doc

Content.`;
    await fs.writeFile(path.join(docsDir, "doc.md"), content);

    const result = await handler.execute({
      rawParams: { action: "update_meta", id: "doc" },
      context,
    });

    const text = result.content[0].text;

    expect(text).toContain("Task");
    expect(text).toContain("description");
    expect(text).toContain("whenToUse");
    expect(text).toContain("Output Format");
  });
});
