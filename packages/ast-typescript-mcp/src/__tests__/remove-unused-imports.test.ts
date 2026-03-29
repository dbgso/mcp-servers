import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoveUnusedImportsHandler } from "../tools/handlers/remove-unused-imports.js";

describe("RemoveUnusedImportsHandler", () => {
  let tempDir: string;
  let handler: RemoveUnusedImportsHandler;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "remove-unused-imports-test-"));
    handler = new RemoveUnusedImportsHandler();
  });

  describe("unused named imports", () => {
    it("should remove single unused named import", async () => {
      const testFile = join(tempDir, "single-unused.ts");
      await writeFile(
        testFile,
        `import { used, unused } from "module";

const x = used();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(1);
      expect(data.removedImports[0].specifiers).toContain("unused");

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("used");
      expect(content).not.toContain("unused");
    });

    it("should remove entire import when all specifiers unused", async () => {
      const testFile = join(tempDir, "all-unused.ts");
      await writeFile(
        testFile,
        `import { unusedA, unusedB } from "unused-module";
import { used } from "used-module";

const x = used();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(2);
      expect(data.removedImports[0].entireDeclaration).toBe(true);

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("unused-module");
      expect(content).toContain("used-module");
    });
  });

  describe("unused default imports", () => {
    it("should remove unused default import", async () => {
      const testFile = join(tempDir, "default-unused.ts");
      await writeFile(
        testFile,
        `import UnusedDefault from "module";
import UsedDefault from "other-module";

const x = UsedDefault();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(1);
      expect(data.removedImports[0].specifiers).toContain("UnusedDefault");

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("UnusedDefault");
      expect(content).toContain("UsedDefault");
    });
  });

  describe("unused namespace imports", () => {
    it("should remove unused namespace import", async () => {
      const testFile = join(tempDir, "namespace-unused.ts");
      await writeFile(
        testFile,
        `import * as UnusedNS from "unused-ns";
import * as UsedNS from "used-ns";

const x = UsedNS.foo();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("UnusedNS");
      expect(content).toContain("UsedNS");
    });
  });

  describe("type imports", () => {
    it("should remove unused type imports", async () => {
      const testFile = join(tempDir, "type-unused.ts");
      await writeFile(
        testFile,
        `import type { UnusedType, UsedType } from "types";

const x: UsedType = {};
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(1);
      expect(data.removedImports[0].specifiers).toContain("UnusedType");

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("UnusedType");
      expect(content).toContain("UsedType");
    });
  });

  describe("side-effect imports", () => {
    it("should preserve side-effect only imports", async () => {
      const testFile = join(tempDir, "side-effect.ts");
      await writeFile(
        testFile,
        `import "side-effect-module";
import { unused } from "other";

export const x = 1;
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain('import "side-effect-module"');
      expect(content).not.toContain("unused");
    });
  });

  describe("dry_run mode", () => {
    it("should not modify file in dry_run mode", async () => {
      const testFile = join(tempDir, "dry-run.ts");
      const originalContent = `import { unused } from "module";

export const x = 1;
`;
      await writeFile(testFile, originalContent);

      const result = await handler.execute({
        file_path: testFile,
        dry_run: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.dryRun).toBe(true);
      expect(data.totalRemoved).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe(originalContent);
    });

    it("should default to dry_run=true", async () => {
      const testFile = join(tempDir, "default-dry.ts");
      const originalContent = `import { unused } from "module";`;
      await writeFile(testFile, originalContent);

      const result = await handler.execute({
        file_path: testFile,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.dryRun).toBe(true);

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe(originalContent);
    });
  });

  describe("organize option", () => {
    it("should organize imports when organize=true", async () => {
      const testFile = join(tempDir, "organize.ts");
      await writeFile(
        testFile,
        `import { z } from "zod";
import { a } from "aaa";
import { unused } from "unused";

const x = z.string();
const y = a();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
        organize: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.organized).toBe(true);

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("unused");
      // After organizing, "aaa" should come before "zod" (alphabetical)
      const aIndex = content.indexOf('"aaa"');
      const zIndex = content.indexOf('"zod"');
      expect(aIndex).toBeLessThan(zIndex);
    });
  });

  describe("mixed imports", () => {
    it("should handle mixed used and unused in same declaration", async () => {
      const testFile = join(tempDir, "mixed.ts");
      await writeFile(
        testFile,
        `import DefaultUnused, { namedUsed, namedUnused } from "mixed-module";

const x = namedUsed();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalRemoved).toBe(2);
      expect(data.removedImports[0].entireDeclaration).toBe(false);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("namedUsed");
      expect(content).not.toContain("namedUnused");
      expect(content).not.toContain("DefaultUnused");
    });
  });

  describe("no unused imports", () => {
    it("should report zero removals when all imports are used", async () => {
      const testFile = join(tempDir, "all-used.ts");
      await writeFile(
        testFile,
        `import { a, b } from "module";

const x = a() + b();
`
      );

      const result = await handler.execute({
        file_path: testFile,
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.totalRemoved).toBe(0);
      expect(data.removedImports).toHaveLength(0);
    });
  });
});
