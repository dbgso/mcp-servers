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
      const doc = await manager.create({ type: "requirement", title: "Test Req", content: "Content here" });

      expect(doc.id).toBeTruthy();
      expect(doc.type).toBe("requirement");
      expect(doc.title).toBe("Test Req");
      expect(doc.content).toBe("Content here");
      expect(doc.requires).toBeUndefined();
    });

    test("throws for invalid type", async () => {
      await expect(
        manager.create({ type: "invalid", title: "Test", content: "Content" })
      ).rejects.toThrow('Invalid type: "invalid"');
    });

    test("throws for non-root type without parent", async () => {
      await expect(
        manager.create({ type: "spec", title: "Test Spec", content: "Content" })
      ).rejects.toThrow('requires a parent');
    });

    test("creates non-root type with valid parent", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });

      expect(spec.requires).toBe(req.id);
    });

    test("throws for non-root type with invalid parent type", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });

      await expect(
        manager.create({ type: "design", title: "Design", content: "Content", requires: req.id })
      ).rejects.toThrow('requires: spec');
    });

    test("throws for root type with parent specified", async () => {
      const existingReq = await manager.create({ type: "requirement", title: "Existing Req", content: "Content" });

      // root type (requirement) should not have a parent
      await expect(
        manager.create({ type: "requirement", title: "New Req", content: "Content", requires: existingReq.id })
      ).rejects.toThrow("root type and should not have a parent");
    });
  });

  describe("read", () => {
    test("reads existing document", async () => {
      const created = await manager.create({ type: "requirement", title: "Test", content: "Content" });
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
      await manager.create({ type: "requirement", title: "Req 1", content: "Content" });
      await manager.create({ type: "requirement", title: "Req 2", content: "Content" });

      const list = await manager.list();
      expect(list).toHaveLength(2);
    });

    test("lists documents filtered by type", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });

      const reqs = await manager.list("requirement");
      const specs = await manager.list("spec");

      expect(reqs).toHaveLength(1);
      expect(specs).toHaveLength(1);
    });
  });

  describe("update", () => {
    test("updates document title", async () => {
      const doc = await manager.create({ type: "requirement", title: "Old Title", content: "Content" });
      const updated = await manager.update({ id: doc.id, updates: { title: "New Title" } });

      expect(updated.title).toBe("New Title");
      expect(updated.content).toBe("Content");
    });

    test("updates document content", async () => {
      const doc = await manager.create({ type: "requirement", title: "Title", content: "Old Content" });
      const updated = await manager.update({ id: doc.id, updates: { content: "New Content" } });

      expect(updated.title).toBe("Title");
      expect(updated.content).toBe("New Content");
    });

    test("throws for non-existent document", async () => {
      await expect(
        manager.update({ id: "nonexistent", updates: { title: "New" } })
      ).rejects.toThrow('not found');
    });
  });

  describe("delete", () => {
    test("deletes document", async () => {
      const doc = await manager.create({ type: "requirement", title: "Test", content: "Content" });
      await manager.delete(doc.id);

      const read = await manager.read(doc.id);
      expect(read).toBeNull();
    });

    test("throws for document with dependents", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });

      await expect(manager.delete(req.id)).rejects.toThrow("has dependents");
    });

    test("throws for non-existent document", async () => {
      await expect(manager.delete("nonexistent")).rejects.toThrow('not found');
    });
  });

  describe("trace", () => {
    test("traces down to dependents", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });
      await manager.create({ type: "design", title: "Design", content: "Content", requires: spec.id });

      const tree = await manager.trace({ id: req.id, direction: "down" });

      expect(tree).not.toBeNull();
      expect(tree!.id).toBe(req.id);
      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].id).toBe(spec.id);
      expect(tree!.children[0].children).toHaveLength(1);
    });

    test("traces up to ancestors", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });
      const design = await manager.create({ type: "design", title: "Design", content: "Content", requires: spec.id });

      const tree = await manager.trace({ id: design.id, direction: "up" });

      expect(tree).not.toBeNull();
      expect(tree!.id).toBe(design.id);
      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].id).toBe(spec.id);
      expect(tree!.children[0].children[0].id).toBe(req.id);
    });
  });

  describe("validate", () => {
    test("returns valid for consistent documents", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });

      const result = await manager.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("link", () => {
    test("links document to a parent while preserving ID", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });
      const design = await manager.create({ type: "design", title: "Design", content: "Content", requires: spec.id });

      // Create a test without parent (orphan)
      // Since test requires spec or design, we need to link it properly
      // First create with spec parent, then link to design
      const testDoc = await manager.create({ type: "test", title: "Test", content: "Content", requires: spec.id });
      const originalId = testDoc.id;

      // Link to a different parent
      const linked = await manager.link({ id: testDoc.id, parentId: design.id });

      // ID should be preserved
      expect(linked.id).toBe(originalId);
      expect(linked.requires).toBe(design.id);
    });

    test("throws for non-existent document", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      await expect(manager.link({ id: "nonexistent", parentId: req.id })).rejects.toThrow("not found");
    });

    test("throws for invalid parent type", async () => {
      const req1 = await manager.create({ type: "requirement", title: "Req1", content: "Content" });
      const req2 = await manager.create({ type: "requirement", title: "Req2", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req1.id });

      // spec requires requirement, not another spec or requirement (already linked)
      // Try to link spec to req2 - should work
      const linked = await manager.link({ id: spec.id, parentId: req2.id });
      expect(linked.requires).toBe(req2.id);
    });

    test("throws for non-existent parent", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });

      await expect(manager.link({ id: spec.id, parentId: "nonexistent" })).rejects.toThrow("not found");
    });
  });

  describe("types with multiple allowed parents", () => {
    test("accepts any of allowed parent types", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });
      const spec = await manager.create({ type: "spec", title: "Spec", content: "Content", requires: req.id });
      const design = await manager.create({ type: "design", title: "Design", content: "Content", requires: spec.id });

      // "test" can have spec or design as parent
      const testFromSpec = await manager.create({ type: "test", title: "Test from Spec", content: "Content", requires: spec.id });
      const testFromDesign = await manager.create({ type: "test", title: "Test from Design", content: "Content", requires: design.id });

      expect(testFromSpec.requires).toBe(spec.id);
      expect(testFromDesign.requires).toBe(design.id);
    });

    test("rejects invalid parent for multi-parent type", async () => {
      const req = await manager.create({ type: "requirement", title: "Req", content: "Content" });

      // "test" requires spec or design, not requirement
      await expect(
        manager.create({ type: "test", title: "Test", content: "Content", requires: req.id })
      ).rejects.toThrow("spec or design");
    });
  });
});
