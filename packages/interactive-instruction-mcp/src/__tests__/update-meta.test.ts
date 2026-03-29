import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerUpdateMetaTool } from "../tools/update-meta.js";
import { MarkdownReader } from "../services/markdown-reader.js";

describe("update_meta tool", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let server: McpServer;
  let toolHandler: (params: { id: string }) => Promise<unknown>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-meta-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);

    // Mock MCP server
    server = {
      registerTool: (_name: string, _schema: unknown, handler: (params: { id: string }) => Promise<unknown>) => {
        toolHandler = handler;
      },
    } as unknown as McpServer;

    registerUpdateMetaTool({
      server,
      reader,
      config: {
        enabled: false,
        remindMcp: false,
        remindOrganize: false,
        customReminders: [],
        topicForEveryTask: null,
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns error for non-existent document", async () => {
    const result = await toolHandler({ id: "nonexistent" });
    const typedResult = result as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(typedResult.isError).toBe(true);
    expect(typedResult.content[0].text).toContain("not found");
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

    const result = await toolHandler({ id: "test-doc" });
    const typedResult = result as { content: Array<{ type: string; text: string }> };

    expect(typedResult.isError).toBeFalsy();
    const text = typedResult.content[0].text;

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

    const result = await toolHandler({ id: "no-meta" });
    const typedResult = result as { content: Array<{ type: string; text: string }> };

    expect(typedResult.isError).toBeFalsy();
    const text = typedResult.content[0].text;

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

    const result = await toolHandler({ id: "doc" });
    const typedResult = result as { content: Array<{ type: string; text: string }> };

    const text = typedResult.content[0].text;

    expect(text).toContain("Task");
    expect(text).toContain("description");
    expect(text).toContain("whenToUse");
    expect(text).toContain("Output Format");
    expect(text).toContain("draft update");
  });
});
