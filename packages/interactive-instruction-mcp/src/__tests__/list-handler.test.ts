import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ListHandler } from "../tools/instruction/handlers/list.js";
import { MarkdownReader } from "../services/markdown-reader.js";

describe("ListHandler", () => {
  let tempDir: string;
  let reader: MarkdownReader;
  let handler: ListHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "list-handler-test-"));
    await fs.mkdir(path.join(tempDir, "_mcp_drafts"), { recursive: true });
    reader = new MarkdownReader(tempDir);
    handler = new ListHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("query (issue #9)", () => {
    // matchesQuery used to search only description+whenToUse, so an English
    // query against a Japanese-only description missed even when the filename
    // carried the English keyword.
    const mixedLocaleDoc = `---
description: ドラフトをユーザーレビューから承認まで進めるワークフロー
whenToUse:
  - ドラフトの承認手順を確認するとき
---

# Draft approval

Body content.`;

    it("matches when the document id contains the query (locale-mismatch case)", async () => {
      await fs.writeFile(path.join(tempDir, "draft-approval.md"), mixedLocaleDoc);

      const result = await handler.execute({
        rawParams: { action: "list", query: "approval" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("draft-approval");
      expect(text).not.toContain("0 found");
    });

    it("still matches by description (existing behavior)", async () => {
      await fs.writeFile(path.join(tempDir, "draft-approval.md"), mixedLocaleDoc);

      const result = await handler.execute({
        rawParams: { action: "list", query: "承認" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("draft-approval");
    });

    it("still matches by whenToUse (existing behavior)", async () => {
      await fs.writeFile(path.join(tempDir, "draft-approval.md"), mixedLocaleDoc);

      const result = await handler.execute({
        rawParams: { action: "list", query: "確認するとき" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("draft-approval");
    });

    it("returns no results when query matches nothing", async () => {
      await fs.writeFile(path.join(tempDir, "draft-approval.md"), mixedLocaleDoc);

      const result = await handler.execute({
        rawParams: { action: "list", query: "nonexistent-keyword" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("0 found");
    });

    it("query is case-insensitive against the id", async () => {
      await fs.writeFile(path.join(tempDir, "Draft-Approval.md"), mixedLocaleDoc);

      const result = await handler.execute({
        rawParams: { action: "list", query: "APPROVAL" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).not.toContain("0 found");
    });
  });
});
