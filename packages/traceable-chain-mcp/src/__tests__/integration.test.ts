import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { ChainManager } from "../chain-manager.js";
import { ChainQueryHandler } from "../tools/handlers/query.js";
import { ChainMutateHandler } from "../tools/handlers/mutate.js";
import type { ChainConfig } from "../types.js";

const TEST_DIR = "/tmp/chain-integration-test";

const testConfig: ChainConfig = {
  types: {
    requirement: { requires: null, description: "Root type" },
    spec: { requires: "requirement", description: "Depends on requirement" },
    design: { requires: "spec", description: "Depends on spec" },
    test: { requires: ["spec", "design"], description: "Depends on spec or design" },
    proposal: { requires: ["requirement", "spec"], description: "Proposal" },
    adr: { requires: "proposal", description: "ADR" },
  },
  storage: {
    basePath: TEST_DIR,
    extension: ".md",
  },
};

describe("Integration: MCP Tool Handlers", () => {
  let manager: ChainManager;
  let queryHandler: ChainQueryHandler;
  let mutateHandler: ChainMutateHandler;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    manager = new ChainManager(testConfig);
    queryHandler = new ChainQueryHandler(manager);
    mutateHandler = new ChainMutateHandler(manager);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("ChainMutateHandler", () => {
    describe("create operation", () => {
      test("creates root type document", async () => {
        const result = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "requirement",
            title: "User Authentication",
            content: "Users must be able to log in",
          },
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text as string);
        expect(response.message).toBe("Document created successfully");
        expect(response.document.type).toBe("requirement");
        expect(response.document.title).toBe("User Authentication");
        expect(response.document.id).toBeTruthy();
      });

      test("creates non-root type with parent", async () => {
        // First create requirement
        const reqResult = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "requirement",
            title: "Feature A",
            content: "Feature A description",
          },
        });
        const req = JSON.parse(reqResult.content[0].text as string).document;

        // Then create spec with parent
        const specResult = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "spec",
            requires: req.id,
            title: "Feature A Spec",
            content: "Technical details",
          },
        });

        expect(specResult.isError).toBeFalsy();
        const spec = JSON.parse(specResult.content[0].text as string).document;
        expect(spec.requires).toBe(req.id);
      });

      test("returns error for non-root type without parent", async () => {
        const result = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "spec",
            title: "Orphan Spec",
            content: "No parent",
          },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("requires a parent");
      });

      test("returns error for invalid type", async () => {
        const result = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "invalid",
            title: "Invalid",
            content: "Content",
          },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Invalid type");
      });
    });

    describe("update operation", () => {
      test("updates document title and content", async () => {
        // Create a document
        const createResult = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "requirement",
            title: "Original Title",
            content: "Original content",
          },
        });
        const doc = JSON.parse(createResult.content[0].text as string).document;

        // Update it
        const updateResult = await mutateHandler.execute({
          operation: "update",
          params: {
            id: doc.id,
            title: "New Title",
            content: "New content",
          },
        });

        expect(updateResult.isError).toBeFalsy();
        const updated = JSON.parse(updateResult.content[0].text as string).document;
        expect(updated.title).toBe("New Title");
      });

      test("returns error for non-existent document", async () => {
        const result = await mutateHandler.execute({
          operation: "update",
          params: {
            id: "nonexistent",
            title: "New Title",
          },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("not found");
      });
    });

    describe("delete operation", () => {
      test("deletes document without dependents", async () => {
        const createResult = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "requirement",
            title: "To Delete",
            content: "Content",
          },
        });
        const doc = JSON.parse(createResult.content[0].text as string).document;

        const deleteResult = await mutateHandler.execute({
          operation: "delete",
          params: { id: doc.id },
        });

        expect(deleteResult.isError).toBeFalsy();
        expect(deleteResult.content[0].text).toContain("deleted successfully");
      });

      test("returns error when document has dependents", async () => {
        // Create parent and child
        const reqResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Parent", content: "Content" },
        });
        const req = JSON.parse(reqResult.content[0].text as string).document;

        await mutateHandler.execute({
          operation: "create",
          params: { type: "spec", requires: req.id, title: "Child", content: "Content" },
        });

        // Try to delete parent
        const deleteResult = await mutateHandler.execute({
          operation: "delete",
          params: { id: req.id },
        });

        expect(deleteResult.isError).toBe(true);
        expect(deleteResult.content[0].text).toContain("dependents");
      });
    });

    describe("link operation", () => {
      test("links document to new parent", async () => {
        // Create two requirements
        const req1Result = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req 1", content: "Content" },
        });
        const req1 = JSON.parse(req1Result.content[0].text as string).document;

        const req2Result = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req 2", content: "Content" },
        });
        const req2 = JSON.parse(req2Result.content[0].text as string).document;

        // Create spec under req1
        const specResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "spec", requires: req1.id, title: "Spec", content: "Content" },
        });
        const spec = JSON.parse(specResult.content[0].text as string).document;

        // Link spec to req2
        const linkResult = await mutateHandler.execute({
          operation: "link",
          params: { id: spec.id, parent_id: req2.id },
        });

        expect(linkResult.isError).toBeFalsy();
        const linked = JSON.parse(linkResult.content[0].text as string).document;
        expect(linked.id).toBe(spec.id); // ID preserved
        expect(linked.requires).toBe(req2.id);
      });
    });

    describe("unknown operation", () => {
      test("returns error for unknown operation", async () => {
        const result = await mutateHandler.execute({
          operation: "unknown",
          params: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown mutate operation");
        expect(result.content[0].text).toContain("Available:");
      });
    });

    describe("validation errors", () => {
      test("returns error for missing required params", async () => {
        const result = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement" }, // missing title and content
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Validation error");
      });
    });
  });

  describe("ChainQueryHandler", () => {
    describe("read operation", () => {
      test("reads existing document", async () => {
        // Create a document
        const createResult = await mutateHandler.execute({
          operation: "create",
          params: {
            type: "requirement",
            title: "Test Doc",
            content: "Test content",
          },
        });
        const created = JSON.parse(createResult.content[0].text as string).document;

        // Read it
        const readResult = await queryHandler.execute({
          operation: "read",
          params: { id: created.id },
        });

        expect(readResult.isError).toBeFalsy();
        const doc = JSON.parse(readResult.content[0].text as string);
        expect(doc.id).toBe(created.id);
        expect(doc.title).toBe("Test Doc");
        expect(doc.content).toBe("Test content");
      });

      test("returns error for non-existent document", async () => {
        const result = await queryHandler.execute({
          operation: "read",
          params: { id: "nonexistent" },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("not found");
      });
    });

    describe("list operation", () => {
      test("lists all documents", async () => {
        // Create multiple documents
        await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req 1", content: "C1" },
        });
        await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req 2", content: "C2" },
        });

        const listResult = await queryHandler.execute({
          operation: "list",
          params: {},
        });

        expect(listResult.isError).toBeFalsy();
        const response = JSON.parse(listResult.content[0].text as string);
        expect(response.total).toBe(2);
        expect(response.documents).toHaveLength(2);
      });

      test("lists documents filtered by type", async () => {
        // Create requirement and spec
        const reqResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req", content: "C" },
        });
        const req = JSON.parse(reqResult.content[0].text as string).document;

        await mutateHandler.execute({
          operation: "create",
          params: { type: "spec", requires: req.id, title: "Spec", content: "C" },
        });

        // List only requirements
        const listResult = await queryHandler.execute({
          operation: "list",
          params: { type: "requirement" },
        });

        const response = JSON.parse(listResult.content[0].text as string);
        expect(response.total).toBe(1);
        expect(response.documents[0].type).toBe("requirement");
      });

      test("returns error for invalid type", async () => {
        const result = await queryHandler.execute({
          operation: "list",
          params: { type: "invalid" },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Invalid type");
      });
    });

    describe("trace operation", () => {
      test("traces down to dependents", async () => {
        // Create chain: requirement -> spec -> design
        const reqResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req", content: "C" },
        });
        const req = JSON.parse(reqResult.content[0].text as string).document;

        const specResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "spec", requires: req.id, title: "Spec", content: "C" },
        });
        const spec = JSON.parse(specResult.content[0].text as string).document;

        await mutateHandler.execute({
          operation: "create",
          params: { type: "design", requires: spec.id, title: "Design", content: "C" },
        });

        // Trace down from requirement
        const traceResult = await queryHandler.execute({
          operation: "trace",
          params: { id: req.id, direction: "down" },
        });

        expect(traceResult.isError).toBeFalsy();
        const tree = JSON.parse(traceResult.content[0].text as string);
        expect(tree.id).toBe(req.id);
        expect(tree.children).toHaveLength(1);
        expect(tree.children[0].type).toBe("spec");
        expect(tree.children[0].children).toHaveLength(1);
        expect(tree.children[0].children[0].type).toBe("design");
      });

      test("traces up to ancestors", async () => {
        // Create chain: requirement -> spec -> design
        const reqResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req", content: "C" },
        });
        const req = JSON.parse(reqResult.content[0].text as string).document;

        const specResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "spec", requires: req.id, title: "Spec", content: "C" },
        });
        const spec = JSON.parse(specResult.content[0].text as string).document;

        const designResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "design", requires: spec.id, title: "Design", content: "C" },
        });
        const design = JSON.parse(designResult.content[0].text as string).document;

        // Trace up from design
        const traceResult = await queryHandler.execute({
          operation: "trace",
          params: { id: design.id, direction: "up" },
        });

        expect(traceResult.isError).toBeFalsy();
        const tree = JSON.parse(traceResult.content[0].text as string);
        expect(tree.id).toBe(design.id);
        expect(tree.children[0].id).toBe(spec.id);
        expect(tree.children[0].children[0].id).toBe(req.id);
      });

      test("returns error for non-existent document", async () => {
        const result = await queryHandler.execute({
          operation: "trace",
          params: { id: "nonexistent" },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("not found");
      });
    });

    describe("validate operation", () => {
      test("returns valid for consistent documents", async () => {
        // Create valid chain
        const reqResult = await mutateHandler.execute({
          operation: "create",
          params: { type: "requirement", title: "Req", content: "C" },
        });
        const req = JSON.parse(reqResult.content[0].text as string).document;

        await mutateHandler.execute({
          operation: "create",
          params: { type: "spec", requires: req.id, title: "Spec", content: "C" },
        });

        const validateResult = await queryHandler.execute({
          operation: "validate",
          params: {},
        });

        expect(validateResult.isError).toBeFalsy();
        const result = JSON.parse(validateResult.content[0].text as string);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("unknown operation", () => {
      test("returns error for unknown operation", async () => {
        const result = await queryHandler.execute({
          operation: "unknown",
          params: {},
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown query operation");
        expect(result.content[0].text).toContain("Available:");
      });
    });
  });
});
