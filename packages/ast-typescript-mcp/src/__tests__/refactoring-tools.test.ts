import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TypeScriptHandler } from "../handlers/typescript.js";

describe("Refactoring Tools", () => {
  let tempDir: string;
  let handler: TypeScriptHandler;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "refactor-test-"));
    handler = new TypeScriptHandler();

    // Create test fixtures
    await mkdir(join(tempDir, "handlers"), { recursive: true });

    // Handler classes for testing
    await writeFile(
      join(tempDir, "handlers", "user-handler.ts"),
      `export class UserHandler {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async execute(): Promise<string> {
    return \`User: \${this.userId}\`;
  }

  async validate(): Promise<boolean> {
    return this.userId.length > 0;
  }
}
`
    );

    await writeFile(
      join(tempDir, "handlers", "order-handler.ts"),
      `export class OrderHandler {
  private orderId: string;

  constructor(orderId: string) {
    this.orderId = orderId;
  }

  async execute(): Promise<string> {
    return \`Order: \${this.orderId}\`;
  }

  async validate(): Promise<boolean> {
    return this.orderId.length > 0;
  }
}
`
    );

    await writeFile(
      join(tempDir, "handlers", "product-handler.ts"),
      `export class ProductHandler {
  private productId: string;

  constructor(productId: string) {
    this.productId = productId;
  }

  async execute(): Promise<string> {
    return \`Product: \${this.productId}\`;
  }

  async getPrice(): Promise<number> {
    return 100;
  }
}
`
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("extractCommonInterface", () => {
    it("should extract common methods from multiple classes", async () => {
      const result = await handler.extractCommonInterface({
        sourceFiles: [
          join(tempDir, "handlers", "user-handler.ts"),
          join(tempDir, "handlers", "order-handler.ts"),
        ],
        interfaceName: "ICommonHandler",
        includeMethods: true,
        includeProperties: false,
        minOccurrence: 1.0,
      });

      expect(result.interfaceName).toBe("ICommonHandler");
      expect(result.analyzedClasses.length).toBe(2);
      expect(result.commonMembers.some((m) => m.name === "execute")).toBe(true);
      expect(result.commonMembers.some((m) => m.name === "validate")).toBe(true);
    });

    it("should include properties when requested", async () => {
      const result = await handler.extractCommonInterface({
        sourceFiles: join(tempDir, "handlers", "*-handler.ts"),
        interfaceName: "IWithProperties",
        includeMethods: false,
        includeProperties: true,
        minOccurrence: 0.5,
      });

      // All handlers have a private *Id property, but we check for common public ones
      expect(result.interfaceName).toBe("IWithProperties");
      expect(result.totalClasses).toBe(3);
    });

    it("should respect minOccurrence threshold", async () => {
      const result = await handler.extractCommonInterface({
        sourceFiles: join(tempDir, "handlers", "*-handler.ts"),
        interfaceName: "IFullyCommon",
        includeMethods: true,
        includeProperties: false,
        minOccurrence: 1.0, // Must be in ALL classes
      });

      // execute() is in all 3, validate() is only in 2, getPrice() is only in 1
      const executeFound = result.commonMembers.find((m) => m.name === "execute");
      expect(executeFound).toBeDefined();
      expect(executeFound?.occurrences).toBe(3);

      // validate() should NOT be included with minOccurrence=1.0
      const validateFound = result.commonMembers.find((m) => m.name === "validate");
      expect(validateFound).toBeUndefined();
    });

    it("should generate valid interface structure", async () => {
      const result = await handler.extractCommonInterface({
        sourceFiles: join(tempDir, "handlers", "*-handler.ts"),
        interfaceName: "IExecutable",
        includeMethods: true,
        includeProperties: false,
        minOccurrence: 1.0,
      });

      expect(result.interfaceStructure).toBeDefined();
      expect(result.interfaceStructure.name).toBe("IExecutable");
      expect(result.interfaceStructure.methods).toBeDefined();
      expect(result.interfaceStructure.methods?.length).toBeGreaterThan(0);
    });
  });

  describe("TransformCallSite - param name mismatch", () => {
    it("should transform call site when call argument names differ from param names", async () => {
      // Test case: call uses `oldName` but param is named `symbolName`
      const testFile = join(tempDir, "call-name-mismatch.ts");
      await writeFile(
        testFile,
        `function gitGrep({ gitRoot, symbolName }: { gitRoot: string; symbolName: string }) {
  return [gitRoot, symbolName];
}

// Call uses 'oldName' variable but param is named 'symbolName'
const gitRoot = "/path/to/repo";
const oldName = "someSymbol";
const result = gitGrep(gitRoot, oldName);
`
      );

      // First, fix the function signature (it's already correct in this test)
      // Then transform the call site with param_names that differ from the call argument names
      const { TransformCallSiteHandler } = await import("../tools/handlers/transform-call-site.js");
      const callHandler = new TransformCallSiteHandler();

      // Simulate calling the handler directly
      const project = (await import("ts-morph")).Project;
      const proj = new project();
      const sourceFile = proj.addSourceFileAtPath(testFile);

      const result2 = callHandler.prepareTransform(
        sourceFile,
        8, // line of gitGrep(gitRoot, oldName)
        16, // column
        ["gitRoot", "symbolName"] // param names differ from call arg names
      );

      expect("error" in result2).toBe(false);
      if (!("error" in result2)) {
        // Should produce: gitGrep({ gitRoot: gitRoot, symbolName: oldName })
        expect(result2.after).toContain("gitRoot: gitRoot");
        expect(result2.after).toContain("symbolName: oldName");
      }
    });
  });
});
