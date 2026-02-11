import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { ChainManager } from "../chain-manager.js";
import type { ChainConfig } from "../types.js";

const TEST_DIR = "/tmp/chain-test-docs";

const testConfig: ChainConfig = {
  types: {
    requirement: { requires: null, description: "Root type" },
    spec: { requires: "requirement", description: "Depends on requirement" },
    design: { requires: "spec", description: "Depends on spec" },
    test: { requires: ["spec", "design"], description: "Depends on spec or design" },
  },
  storage: {
    basePath: TEST_DIR,
    extension: ".md",
  },
};

describe("ChainManager", () => {
  let manager: ChainManager;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    manager = new ChainManager(testConfig);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("getTypes", () => {
    test("returns configured types", () => {
      const types = manager.getTypes();
      expect(Object.keys(types)).toEqual(["requirement", "spec", "design", "test"]);
    });
  });

  describe("getRootTypes", () => {
    test("returns types with null requires", () => {
      const rootTypes = manager.getRootTypes();
      expect(rootTypes).toEqual(["requirement"]);
    });
  });

  describe("isValidType", () => {
    test("returns true for valid types", () => {
      expect(manager.isValidType("requirement")).toBe(true);
      expect(manager.isValidType("spec")).toBe(true);
    });

    test("returns false for invalid types", () => {
      expect(manager.isValidType("invalid")).toBe(false);
    });
  });

  describe("create", () => {
    test("creates root type document without parent", async () => {
      const doc = await manager.create("requirement", "Test Req", "Content here");

      expect(doc.id).toBeTruthy();
      expect(doc.type).toBe("requirement");
      expect(doc.title).toBe("Test Req");
      expect(doc.content).toBe("Content here");
      expect(doc.requires).toBeUndefined();
    });

    test("throws for invalid type", async () => {
      await expect(
        manager.create("invalid", "Test", "Content")
      ).rejects.toThrow('Invalid type: "invalid"');
    });

    test("throws for non-root type without parent", async () => {
      await expect(
        manager.create("spec", "Test Spec", "Content")
      ).rejects.toThrow('requires a parent');
    });

    test("creates non-root type with valid parent", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      const spec = await manager.create("spec", "Spec", "Content", req.id);

      expect(spec.requires).toBe(req.id);
    });

    test("throws for non-root type with invalid parent type", async () => {
      const req = await manager.create("requirement", "Req", "Content");

      await expect(
        manager.create("design", "Design", "Content", req.id)
      ).rejects.toThrow('requires: spec');
    });
  });

  describe("read", () => {
    test("reads existing document", async () => {
      const created = await manager.create("requirement", "Test", "Content");
      const read = await manager.read(created.id);

      expect(read).not.toBeNull();
      expect(read!.id).toBe(created.id);
      expect(read!.title).toBe("Test");
    });

    test("returns null for non-existent document", async () => {
      const read = await manager.read("nonexistent");
      expect(read).toBeNull();
    });
  });

  describe("list", () => {
    test("lists all documents", async () => {
      await manager.create("requirement", "Req 1", "Content");
      await manager.create("requirement", "Req 2", "Content");

      const list = await manager.list();
      expect(list).toHaveLength(2);
    });

    test("lists documents filtered by type", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      await manager.create("spec", "Spec", "Content", req.id);

      const reqs = await manager.list("requirement");
      const specs = await manager.list("spec");

      expect(reqs).toHaveLength(1);
      expect(specs).toHaveLength(1);
    });
  });

  describe("update", () => {
    test("updates document title", async () => {
      const doc = await manager.create("requirement", "Old Title", "Content");
      const updated = await manager.update(doc.id, { title: "New Title" });

      expect(updated.title).toBe("New Title");
      expect(updated.content).toBe("Content");
    });

    test("updates document content", async () => {
      const doc = await manager.create("requirement", "Title", "Old Content");
      const updated = await manager.update(doc.id, { content: "New Content" });

      expect(updated.title).toBe("Title");
      expect(updated.content).toBe("New Content");
    });

    test("throws for non-existent document", async () => {
      await expect(
        manager.update("nonexistent", { title: "New" })
      ).rejects.toThrow('not found');
    });
  });

  describe("delete", () => {
    test("deletes document", async () => {
      const doc = await manager.create("requirement", "Test", "Content");
      await manager.delete(doc.id);

      const read = await manager.read(doc.id);
      expect(read).toBeNull();
    });

    test("throws for document with dependents", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      await manager.create("spec", "Spec", "Content", req.id);

      await expect(manager.delete(req.id)).rejects.toThrow("has dependents");
    });

    test("throws for non-existent document", async () => {
      await expect(manager.delete("nonexistent")).rejects.toThrow('not found');
    });
  });

  describe("trace", () => {
    test("traces down to dependents", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      const spec = await manager.create("spec", "Spec", "Content", req.id);
      await manager.create("design", "Design", "Content", spec.id);

      const tree = await manager.trace(req.id, "down");

      expect(tree).not.toBeNull();
      expect(tree!.id).toBe(req.id);
      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].id).toBe(spec.id);
      expect(tree!.children[0].children).toHaveLength(1);
    });

    test("traces up to ancestors", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      const spec = await manager.create("spec", "Spec", "Content", req.id);
      const design = await manager.create("design", "Design", "Content", spec.id);

      const tree = await manager.trace(design.id, "up");

      expect(tree).not.toBeNull();
      expect(tree!.id).toBe(design.id);
      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].id).toBe(spec.id);
      expect(tree!.children[0].children[0].id).toBe(req.id);
    });
  });

  describe("validate", () => {
    test("returns valid for consistent documents", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      await manager.create("spec", "Spec", "Content", req.id);

      const result = await manager.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("types with multiple allowed parents", () => {
    test("accepts any of allowed parent types", async () => {
      const req = await manager.create("requirement", "Req", "Content");
      const spec = await manager.create("spec", "Spec", "Content", req.id);
      const design = await manager.create("design", "Design", "Content", spec.id);

      // "test" can have spec or design as parent
      const testFromSpec = await manager.create("test", "Test from Spec", "Content", spec.id);
      const testFromDesign = await manager.create("test", "Test from Design", "Content", design.id);

      expect(testFromSpec.requires).toBe(spec.id);
      expect(testFromDesign.requires).toBe(design.id);
    });

    test("rejects invalid parent for multi-parent type", async () => {
      const req = await manager.create("requirement", "Req", "Content");

      // "test" requires spec or design, not requirement
      await expect(
        manager.create("test", "Test", "Content", req.id)
      ).rejects.toThrow("spec or design");
    });
  });
});
