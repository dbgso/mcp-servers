import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { generateDiff, formatDiffForDisplay, writeDiffToFile } from "../utils/diff-utils.js";

describe("diff-utils", () => {
  describe("generateDiff", () => {
    it("returns empty string when content is identical", () => {
      const content = "line1\nline2\nline3";
      const result = generateDiff({ original: content, updated: content });
      expect(result).toBe("");
    });

    it("generates unified diff for changed content", () => {
      const original = "line1\nline2\nline3";
      const updated = "line1\nmodified\nline3";

      const result = generateDiff({ original, updated });

      expect(result).toContain("-line2");
      expect(result).toContain("+modified");
    });

    it("uses custom file names in diff header", () => {
      const original = "old content";
      const updated = "new content";

      const result = generateDiff({
        original,
        updated,
        options: {
          originalName: "docs/original.md",
          newName: "docs/draft.md",
        },
      });

      expect(result).toContain("--- docs/original.md");
      expect(result).toContain("+++ docs/draft.md");
    });

    it("generates diff for added lines", () => {
      const original = "line1\nline2";
      const updated = "line1\nline2\nline3\nline4";

      const result = generateDiff({ original, updated });

      expect(result).toContain("+line3");
      expect(result).toContain("+line4");
    });

    it("generates diff for removed lines", () => {
      const original = "line1\nline2\nline3";
      const updated = "line1";

      const result = generateDiff({ original, updated });

      expect(result).toContain("-line2");
      expect(result).toContain("-line3");
    });
  });

  describe("formatDiffForDisplay", () => {
    it("returns empty string for empty diff", () => {
      const result = formatDiffForDisplay("");
      expect(result).toBe("");
    });

    it("wraps diff in markdown code block with diff syntax", () => {
      const diff = "--- a\n+++ b\n-old\n+new";
      const result = formatDiffForDisplay(diff);

      expect(result).toContain("```diff");
      expect(result).toContain("```");
      expect(result).toContain(diff);
    });
  });

  describe("writeDiffToFile", () => {
    const createdFiles: string[] = [];
    // Diff files are scoped to the documents directory, so that two servers on
    // one machine do not write into each other's store.
    let docsDir: string;

    beforeEach(async () => {
      docsDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-utils-docs-"));
    });

    afterEach(async () => {
      for (const file of createdFiles) {
        try {
          await fs.unlink(file);
        } catch {
          // Ignore cleanup errors
        }
      }
      createdFiles.length = 0;
    });

    it("writes diff to temp file and returns path", async () => {
      const diff = "--- a\n+++ b\n-old\n+new";
      const filePath = await writeDiffToFile({ diff, id: "test-doc", docsDir });
      createdFiles.push(filePath);

      expect(filePath).toContain("test-doc");
      expect(filePath).toMatch(/\.diff$/);

      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe(diff);
    });

    it("encodes an id that is not filename-safe", async () => {
      const diff = "test diff";
      const filePath = await writeDiffToFile({ diff, id: "path/to/doc", docsDir });
      createdFiles.push(filePath);

      // Percent-encoded rather than character-replaced, so two ids cannot land
      // on the same diff file.
      expect(path.basename(filePath)).toContain("path%2Fto%2Fdoc");
      expect(filePath).not.toContain("/to/");
    });
  });
});
