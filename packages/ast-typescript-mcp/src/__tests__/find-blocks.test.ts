import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FindBlocksHandler } from "../tools/handlers/find-blocks.js";

describe("FindBlocksHandler", () => {
  let tempDir: string;
  let handler: FindBlocksHandler;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "find-blocks-test-"));
    handler = new FindBlocksHandler();

    // Create test fixtures
    await writeFile(
      join(tempDir, "simple.test.ts"),
      `describe("UserHandler", () => {
  it("should create user", () => {
    expect(true).toBe(true);
  });

  it("should delete user", () => {
    expect(true).toBe(true);
  });
});

describe("OrderHandler", () => {
  beforeAll(() => {
    console.log("setup");
  });

  it("should create order", () => {
    expect(true).toBe(true);
  });
});
`
    );

    await writeFile(
      join(tempDir, "nested.test.ts"),
      `describe("LinkSuggestionHandler", () => {
  describe("with valid input", () => {
    it("should suggest links", () => {
      expect(true).toBe(true);
    });

    it("should filter by type", () => {
      expect(true).toBe(true);
    });
  });

  describe("with invalid input", () => {
    it("should throw error", () => {
      expect(true).toBe(true);
    });
  });
});

describe("FindDuplicatesHandler", () => {
  it("should find duplicates", () => {
    expect(true).toBe(true);
  });
});
`
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("basic functionality", () => {
    it("should find describe blocks", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["describe"],
        include_nested: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalCount).toBe(2);
      expect(data.blocks).toHaveLength(2);
      expect(data.blocks[0].name).toBe("UserHandler");
      expect(data.blocks[1].name).toBe("OrderHandler");
      expect(data.byType.describe).toBe(2);
    });

    it("should find it blocks", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["it"],
        include_nested: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalCount).toBe(3);
      expect(data.byType.it).toBe(3);
    });

    it("should include start and end lines", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["describe"],
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      const userHandler = data.blocks[0];

      expect(userHandler.startLine).toBe(1);
      expect(userHandler.endLine).toBeGreaterThan(userHandler.startLine);
      expect(userHandler.column).toBeGreaterThan(0);
    });
  });

  describe("name pattern filtering", () => {
    it("should filter by regex pattern", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["describe"],
        name_pattern: "Handler$",
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalCount).toBe(2);
      expect(data.blocks.every((b: { name: string }) => b.name.endsWith("Handler"))).toBe(true);
    });

    it("should return empty for non-matching pattern", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["describe"],
        name_pattern: "^NonExistent",
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.totalCount).toBe(0);
    });
  });

  describe("nested blocks", () => {
    it("should include nested blocks in tree structure", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "nested.test.ts"),
        block_types: ["describe", "it"],
        include_nested: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Root level: LinkSuggestionHandler, FindDuplicatesHandler
      expect(data.blocks).toHaveLength(2);

      const linkHandler = data.blocks.find((b: { name: string }) => b.name === "LinkSuggestionHandler");
      expect(linkHandler).toBeDefined();
      expect(linkHandler.children.length).toBeGreaterThan(0);

      // Nested describe blocks should have children
      const withValidInput = linkHandler.children.find((c: { name: string }) => c.name === "with valid input");
      expect(withValidInput).toBeDefined();
      expect(withValidInput.depth).toBe(1);
    });

    it("should calculate depth correctly", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "nested.test.ts"),
        block_types: ["describe", "it"],
        include_nested: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // With tree structure, check depths recursively
      const linkHandler = data.blocks.find((b: { name: string }) => b.name === "LinkSuggestionHandler");
      expect(linkHandler).toBeDefined();
      expect(linkHandler.depth).toBe(0);

      // Nested describe should have depth 1
      const nestedDescribe = linkHandler.children.find((c: { name: string }) => c.name === "with valid input");
      expect(nestedDescribe).toBeDefined();
      expect(nestedDescribe.depth).toBe(1);

      // it inside nested describe should have depth 2
      const nestedIt = nestedDescribe.children.find((c: { name: string }) => c.name === "should suggest links");
      expect(nestedIt).toBeDefined();
      expect(nestedIt.depth).toBe(2);
    });

    it("should track parent block name", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "nested.test.ts"),
        block_types: ["describe", "it"],
        include_nested: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Navigate to nested it block
      const linkHandler = data.blocks.find((b: { name: string }) => b.name === "LinkSuggestionHandler");
      const nestedDescribe = linkHandler.children.find((c: { name: string }) => c.name === "with valid input");
      const nestedIt = nestedDescribe.children.find((c: { name: string }) => c.name === "should suggest links");

      expect(nestedIt).toBeDefined();
      expect(nestedIt.parent).toBe("with valid input");
    });
  });

  describe("glob patterns", () => {
    it("should search multiple files with glob", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "*.test.ts"),
        block_types: ["describe"],
        name_pattern: "Handler$",
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.filesSearched).toBe(2);
      // UserHandler, OrderHandler, LinkSuggestionHandler, FindDuplicatesHandler
      expect(data.totalCount).toBe(4);
    });
  });

  describe("name_pattern with nested blocks", () => {
    it("should return matching blocks with correct structure when using name_pattern", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "nested.test.ts"),
        block_types: ["describe"],
        name_pattern: "Handler$",
        include_nested: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Should find LinkSuggestionHandler and FindDuplicatesHandler
      expect(data.totalCount).toBe(2);
      expect(data.blocks.length).toBe(2);
      expect(data.blocks.some((b: { name: string }) => b.name === "LinkSuggestionHandler")).toBe(true);
      expect(data.blocks.some((b: { name: string }) => b.name === "FindDuplicatesHandler")).toBe(true);
    });

    it("should return flat list when include_nested is false with name_pattern", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "nested.test.ts"),
        block_types: ["describe"],
        name_pattern: "Handler$",
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Should still find both Handler blocks (they are at depth 0)
      expect(data.totalCount).toBe(2);
      expect(data.blocks.length).toBe(2);
    });
  });

  describe("deeply nested matching blocks", () => {
    let deeplyNestedFile: string;

    beforeAll(async () => {
      // Create a file where matching blocks are NOT at depth 0
      deeplyNestedFile = join(tempDir, "deeply-nested.test.ts");
      await writeFile(
        deeplyNestedFile,
        `describe("Integration Tests", () => {
  describe("LinkSuggestionHandler", () => {
    it("should suggest links", () => {
      expect(true).toBe(true);
    });
  });

  describe("FindDuplicatesHandler", () => {
    it("should find duplicates", () => {
      expect(true).toBe(true);
    });
  });

  describe("AnalyzeDocumentationHandler", () => {
    it("should analyze docs", () => {
      expect(true).toBe(true);
    });
  });
});
`
      );
    });

    it("should find nested matching blocks and return them in blocks array", async () => {
      const result = await handler.execute({
        file_path: deeplyNestedFile,
        block_types: ["describe"],
        name_pattern: "Handler$",
        include_nested: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Should find 3 Handler blocks even though they're nested
      expect(data.totalCount).toBe(3);
      // blocks should contain the matching blocks, not just root
      expect(data.blocks.length).toBeGreaterThan(0);

      // Flatten and check all matching blocks are accessible
      function flattenBlocks(blocks: CallBlock[]): CallBlock[] {
        const result: CallBlock[] = [];
        for (const b of blocks) {
          result.push(b);
          if (b.children) result.push(...flattenBlocks(b.children));
        }
        return result;
      }
      type CallBlock = { name: string; children?: CallBlock[] };

      const allBlocks = flattenBlocks(data.blocks);
      const handlerBlocks = allBlocks.filter((b: { name: string }) => b.name.endsWith("Handler"));
      expect(handlerBlocks.length).toBe(3);
    });

    it("should include nested matching blocks when include_nested is false", async () => {
      const result = await handler.execute({
        file_path: deeplyNestedFile,
        block_types: ["describe"],
        name_pattern: "Handler$",
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // totalCount should reflect all matches
      expect(data.totalCount).toBe(3);
      // Even with include_nested: false, matching blocks should be returned
      // (they should be flat, without their children)
      expect(data.blocks.length).toBe(3);
      expect(data.blocks.every((b: { name: string }) => b.name.endsWith("Handler"))).toBe(true);
    });
  });

  describe("include_source option", () => {
    it("should include source code when requested", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["describe"],
        name_pattern: "^UserHandler$",
        include_nested: false,
        include_source: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.blocks[0].source).toBeDefined();
      expect(data.blocks[0].source).toContain("describe(\"UserHandler\"");
    });

    it("should not include source by default", async () => {
      const result = await handler.execute({
        file_path: join(tempDir, "simple.test.ts"),
        block_types: ["describe"],
        include_nested: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.blocks[0].source).toBeUndefined();
    });
  });
});
