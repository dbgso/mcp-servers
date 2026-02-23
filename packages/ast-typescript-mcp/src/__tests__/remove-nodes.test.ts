import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoveNodesHandler } from "../tools/handlers/remove-nodes.js";

describe("RemoveNodesHandler", () => {
  let tempDir: string;
  let handler: RemoveNodesHandler;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "remove-nodes-test-"));
    handler = new RemoveNodesHandler();
  });

  afterAll(async () => {
    // Cleanup handled by OS temp directory cleanup
  });

  describe("remove named declarations", () => {
    it("should remove a function by name", async () => {
      const testFile = join(tempDir, "functions.ts");
      await writeFile(
        testFile,
        `function keepThis() {
  return 1;
}

function removeThis() {
  return 2;
}

function alsoKeep() {
  return 3;
}
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "function", name: "removeThis" }],
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.removedCount).toBe(1);
      expect(data.results[0].nodeName).toBe("removeThis");
      expect(data.results[0].success).toBe(true);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("keepThis");
      expect(content).not.toContain("removeThis");
      expect(content).toContain("alsoKeep");
    });

    it("should remove a class by name", async () => {
      const testFile = join(tempDir, "classes.ts");
      await writeFile(
        testFile,
        `class KeepClass {
  value = 1;
}

class RemoveClass {
  value = 2;
}
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "class", name: "RemoveClass" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("KeepClass");
      expect(content).not.toContain("RemoveClass");
    });

    it("should remove an interface by name", async () => {
      const testFile = join(tempDir, "interfaces.ts");
      await writeFile(
        testFile,
        `interface Keep {
  a: string;
}

interface Remove {
  b: number;
}
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "interface", name: "Remove" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("interface Keep");
      expect(content).not.toContain("interface Remove");
    });

    it("should remove a type alias by name", async () => {
      const testFile = join(tempDir, "types.ts");
      await writeFile(
        testFile,
        `type Keep = string;
type Remove = number;
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "type", name: "Remove" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("type Keep");
      expect(content).not.toContain("type Remove");
    });

    it("should remove a variable by name", async () => {
      const testFile = join(tempDir, "variables.ts");
      await writeFile(
        testFile,
        `const keep = 1;
const remove = 2;
const alsoKeep = 3;
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "variable", name: "remove" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("const keep");
      expect(content).not.toContain("const remove");
      expect(content).toContain("const alsoKeep");
    });

    it("should remove an enum by name", async () => {
      const testFile = join(tempDir, "enums.ts");
      await writeFile(
        testFile,
        `enum Keep {
  A = 1,
  B = 2,
}

enum Remove {
  X = 10,
  Y = 20,
}
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "enum", name: "Remove" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("enum Keep");
      expect(content).not.toContain("enum Remove");
    });
  });

  describe("statement_at_line", () => {
    it("should remove statement at specified line", async () => {
      const testFile = join(tempDir, "lines.ts");
      await writeFile(
        testFile,
        `const a = 1;
const b = 2;
const c = 3;
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "statement_at_line", line: 2 }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("const a");
      expect(content).not.toContain("const b");
      expect(content).toContain("const c");
    });
  });

  describe("remove call blocks", () => {
    it("should remove describe block by exact first_arg", async () => {
      const testFile = join(tempDir, "test.ts");
      await writeFile(
        testFile,
        `describe("KeepHandler", () => {
  it("should work", () => {});
});

describe("RemoveHandler", () => {
  it("should be removed", () => {});
});

describe("AlsoKeepHandler", () => {
  it("should stay", () => {});
});
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "call_block", call_name: "describe", first_arg: "RemoveHandler" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);
      expect(data.results[0].nodeName).toBe("RemoveHandler");

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("KeepHandler");
      expect(content).not.toContain("RemoveHandler");
      expect(content).toContain("AlsoKeepHandler");
    });

    it("should remove multiple describe blocks by pattern", async () => {
      const testFile = join(tempDir, "multi-test.ts");
      await writeFile(
        testFile,
        `describe("FeatureA", () => {});

describe("LinkSuggestionHandler", () => {
  it("test1", () => {});
});

describe("FindDuplicatesHandler", () => {
  it("test2", () => {});
});

describe("FeatureB", () => {});

describe("AnalyzeDocHandler", () => {
  it("test3", () => {});
});
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "call_block", call_name: "describe", first_arg_pattern: "Handler$" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(3);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("FeatureA");
      expect(content).toContain("FeatureB");
      expect(content).not.toContain("LinkSuggestionHandler");
      expect(content).not.toContain("FindDuplicatesHandler");
      expect(content).not.toContain("AnalyzeDocHandler");
    });

    it("should remove multiple specific blocks", async () => {
      const testFile = join(tempDir, "specific-test.ts");
      await writeFile(
        testFile,
        `describe("Handler1", () => {});
describe("Handler2", () => {});
describe("Handler3", () => {});
describe("Handler4", () => {});
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [
          { type: "call_block", call_name: "describe", first_arg: "Handler1" },
          { type: "call_block", call_name: "describe", first_arg: "Handler3" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(2);

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("Handler1");
      expect(content).toContain("Handler2");
      expect(content).not.toContain("Handler3");
      expect(content).toContain("Handler4");
    });
  });

  describe("dry_run mode", () => {
    it("should not modify file in dry_run mode", async () => {
      const testFile = join(tempDir, "dry-run.ts");
      const originalContent = `function removeMe() {}
function keepMe() {}
`;
      await writeFile(testFile, originalContent);

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "function", name: "removeMe" }],
        dry_run: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.dryRun).toBe(true);
      expect(data.removedCount).toBe(1);
      expect(data.results[0].success).toBe(true);

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe(originalContent);
    });

    it("should default to dry_run=true", async () => {
      const testFile = join(tempDir, "default-dry.ts");
      const originalContent = `function removeMe() {}`;
      await writeFile(testFile, originalContent);

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "function", name: "removeMe" }],
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.dryRun).toBe(true);

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe(originalContent);
    });
  });

  describe("error handling", () => {
    it("should report not found targets", async () => {
      const testFile = join(tempDir, "not-found.ts");
      await writeFile(testFile, `function existing() {}`);

      const result = await handler.execute({
        file_path: testFile,
        targets: [{ type: "function", name: "nonExistent" }],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(0);
      expect(data.failedCount).toBe(1);
      expect(data.results[0].success).toBe(false);
      expect(data.results[0].error).toContain("not found");
    });

    it("should continue with other targets when one fails", async () => {
      const testFile = join(tempDir, "partial.ts");
      await writeFile(
        testFile,
        `function keep() {}
function remove() {}
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [
          { type: "function", name: "nonExistent" },
          { type: "function", name: "remove" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(1);
      expect(data.failedCount).toBe(1);

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("keep");
      expect(content).not.toContain("function remove");
    });
  });

  describe("line number handling", () => {
    it("should remove multiple nodes without line shift issues", async () => {
      const testFile = join(tempDir, "multi-remove.ts");
      await writeFile(
        testFile,
        `// Line 1
describe("First", () => {    // Lines 2-4
  it("test", () => {});
});

describe("Second", () => {   // Lines 6-8
  it("test", () => {});
});

describe("Third", () => {    // Lines 10-12
  it("test", () => {});
});

describe("Fourth", () => {   // Lines 14-16
  it("test", () => {});
});
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [
          { type: "call_block", call_name: "describe", first_arg: "First" },
          { type: "call_block", call_name: "describe", first_arg: "Third" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(2);

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("First");
      expect(content).toContain("Second");
      expect(content).not.toContain("Third");
      expect(content).toContain("Fourth");
    });

    it("should report original line numbers in results", async () => {
      const testFile = join(tempDir, "line-numbers.ts");
      await writeFile(
        testFile,
        `describe("Block1", () => {});

describe("Block2", () => {});
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [
          { type: "call_block", call_name: "describe", first_arg: "Block1" },
          { type: "call_block", call_name: "describe", first_arg: "Block2" },
        ],
        dry_run: true,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Results should be sorted by original line numbers
      expect(data.results[0].nodeName).toBe("Block1");
      expect(data.results[0].startLine).toBe(1);
      expect(data.results[1].nodeName).toBe("Block2");
      expect(data.results[1].startLine).toBe(3);
    });
  });

  describe("mixed node types", () => {
    it("should remove different node types in one call", async () => {
      const testFile = join(tempDir, "mixed.ts");
      await writeFile(
        testFile,
        `function removeFunc() {}

class RemoveClass {}

interface RemoveInterface {}

const keepConst = 1;

describe("RemoveTest", () => {});
`
      );

      const result = await handler.execute({
        file_path: testFile,
        targets: [
          { type: "function", name: "removeFunc" },
          { type: "class", name: "RemoveClass" },
          { type: "interface", name: "RemoveInterface" },
          { type: "call_block", call_name: "describe", first_arg: "RemoveTest" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.removedCount).toBe(4);

      const content = await readFile(testFile, "utf-8");
      expect(content).not.toContain("removeFunc");
      expect(content).not.toContain("RemoveClass");
      expect(content).not.toContain("RemoveInterface");
      expect(content).not.toContain("RemoveTest");
      expect(content).toContain("keepConst");
    });
  });
});
