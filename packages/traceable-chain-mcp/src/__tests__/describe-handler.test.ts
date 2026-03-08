import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { ChainDescribeHandler } from "../tools/handlers/describe.js";
import { ChainManager } from "../chain-manager.js";
import type { ChainConfig } from "../types.js";

const TEST_DIR = "/tmp/chain-describe-test";

const testConfig: ChainConfig = {
  types: {
    requirement: { requires: null, description: "Business requirement" },
    spec: { requires: "requirement", description: "Technical specification" },
    proposal: { requires: ["requirement", "spec"], description: "Decision proposal" },
    adr: { requires: "proposal", description: "Architecture Decision Record" },
  },
  storage: {
    basePath: TEST_DIR,
    extension: ".md",
  },
};

describe("ChainDescribeHandler", () => {
  let handler: ChainDescribeHandler;
  let manager: ChainManager;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    manager = new ChainManager(testConfig);
    handler = new ChainDescribeHandler(manager);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("list mode (no operation)", () => {
    test("shows configured types", async () => {
      const result = await handler.execute({});

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Configured Types");
      expect(text).toContain("requirement");
      expect(text).toContain("spec");
      expect(text).toContain("proposal");
      expect(text).toContain("adr");
    });

    test("shows query and mutate operations", async () => {
      const result = await handler.execute({});

      const text = result.content[0].text as string;
      expect(text).toContain("Query Operations");
      expect(text).toContain("Mutate Operations");
      expect(text).toContain("read");
      expect(text).toContain("list");
      expect(text).toContain("trace");
      expect(text).toContain("create");
      expect(text).toContain("update");
      expect(text).toContain("delete");
    });

    test("shows guide prompt at the end", async () => {
      const result = await handler.execute({});

      const text = result.content[0].text as string;
      expect(text).toContain('chain_describe({ operation: "guide" })');
      expect(text).toContain("Important");
    });
  });

  describe("guide mode", () => {
    test("shows guide content when operation is 'guide'", async () => {
      const result = await handler.execute({ operation: "guide" });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Chain Structure Guide");
    });

    test("explains core principle about tracing", async () => {
      const result = await handler.execute({ operation: "guide" });

      const text = result.content[0].text as string;
      expect(text).toContain("trace");
      expect(text).toContain("requirement");
    });

    test("shows type hierarchy", async () => {
      const result = await handler.execute({ operation: "guide" });

      const text = result.content[0].text as string;
      expect(text).toContain("Type Hierarchy");
      expect(text).toContain("requirement (root)");
      expect(text).toContain("spec");
      expect(text).toContain("proposal");
      expect(text).toContain("adr");
    });

    test("warns about orphaned requirements", async () => {
      const result = await handler.execute({ operation: "guide" });

      const text = result.content[0].text as string;
      expect(text).toContain("Orphaned Requirements");
      expect(text).toContain("Wrong");
      expect(text).toContain("Correct");
    });

    test("explains when to create new requirement", async () => {
      const result = await handler.execute({ operation: "guide" });

      const text = result.content[0].text as string;
      expect(text).toContain("When to Create New Requirement");
      expect(text).toContain("DO create");
      expect(text).toContain("DON'T create");
    });

    test("notes that requires field cannot be changed", async () => {
      const result = await handler.execute({ operation: "guide" });

      const text = result.content[0].text as string;
      expect(text).toContain("requires");
      expect(text).toContain("cannot be changed");
    });
  });

  describe("operation detail mode", () => {
    test("shows details for valid operation", async () => {
      const result = await handler.execute({ operation: "create" });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("create");
      expect(text).toContain("Parameters");
    });

    test("includes guide in available operations when unknown", async () => {
      const result = await handler.execute({ operation: "unknown" });

      expect(result.isError).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain("Unknown operation");
      expect(text).toContain("guide");
    });
  });
});
