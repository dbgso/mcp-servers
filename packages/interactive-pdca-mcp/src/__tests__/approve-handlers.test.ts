import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SetupTemplatesHandler } from "../tools/approve/handlers/setup-templates-handler.js";
import { SkipTemplatesHandler } from "../tools/approve/handlers/skip-templates-handler.js";
import type { ApproveActionParams, ApproveActionContext } from "../types/index.js";

describe("SetupTemplatesHandler", () => {
  let handler: SetupTemplatesHandler;
  let testDir: string;
  let mockContext: ApproveActionContext;

  beforeEach(async () => {
    handler = new SetupTemplatesHandler();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "approve-templates-test-"));

    mockContext = {
      markdownDir: testDir,
      planReader: {} as ApproveActionContext["planReader"],
      planReporter: {} as ApproveActionContext["planReporter"],
      feedbackReader: {} as ApproveActionContext["feedbackReader"],
    };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("execute", () => {
    it("should copy templates when they do not exist", async () => {
      const actionParams: ApproveActionParams = { target: "setup_templates" };
      const result = await handler.execute({ actionParams, context: mockContext });

      expect(result.content[0].text).toContain("Self-review templates have been set up");
      expect(result.isError).toBeUndefined();

      // Verify templates were copied
      const selfReviewDir = path.join(testDir, "_mcp-interactive-instruction/plan/self-review");
      const stat = await fs.stat(selfReviewDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should return already_exists when templates exist", async () => {
      // Create templates first
      const selfReviewDir = path.join(testDir, "_mcp-interactive-instruction/plan/self-review");
      await fs.mkdir(selfReviewDir, { recursive: true });
      await fs.writeFile(path.join(selfReviewDir, "plan.md"), "# Test");

      const actionParams: ApproveActionParams = { target: "setup_templates" };
      const result = await handler.execute({ actionParams, context: mockContext });

      expect(result.content[0].text).toContain("Self-review templates already exist");
    });

    it("should handle created_empty case gracefully", async () => {
      // This case happens when template files are not found in the package
      // We can simulate this by mocking setupSelfReviewTemplates
      const mockSetup = vi.fn().mockResolvedValue({
        action: "created_empty",
        path: path.join(testDir, "_mcp-interactive-instruction/plan"),
      });

      // Use dependency injection by temporarily replacing the module
      const originalModule = await import("../services/template-setup.js");
      vi.spyOn(originalModule, "setupSelfReviewTemplates").mockImplementation(mockSetup);

      const actionParams: ApproveActionParams = { target: "setup_templates" };
      const result = await handler.execute({ actionParams, context: mockContext });

      expect(result.content[0].text).toContain("Created plan directory");
      expect(result.content[0].text).toContain("Template files were not found");

      vi.restoreAllMocks();
    });

    it("should return error when setup fails", async () => {
      // Make the directory read-only to cause an error
      const readOnlyDir = path.join(testDir, "readonly");
      await fs.mkdir(readOnlyDir, { mode: 0o444 });

      const errorContext: ApproveActionContext = {
        ...mockContext,
        markdownDir: path.join(readOnlyDir, "nested/dir"),
      };

      const actionParams: ApproveActionParams = { target: "setup_templates" };
      const result = await handler.execute({ actionParams, context: errorContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error setting up templates");

      // Cleanup
      await fs.chmod(readOnlyDir, 0o755);
    });
  });
});

describe("SkipTemplatesHandler", () => {
  let handler: SkipTemplatesHandler;
  let testDir: string;
  let mockContext: ApproveActionContext;

  beforeEach(async () => {
    handler = new SkipTemplatesHandler();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "skip-templates-test-"));

    mockContext = {
      markdownDir: testDir,
      planReader: {} as ApproveActionContext["planReader"],
      planReporter: {} as ApproveActionContext["planReporter"],
      feedbackReader: {} as ApproveActionContext["feedbackReader"],
    };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("execute", () => {
    it("should create empty plan directory", async () => {
      const actionParams: ApproveActionParams = { target: "skip_templates" };
      const result = await handler.execute({ actionParams, context: mockContext });

      expect(result.content[0].text).toContain("Created empty plan directory");
      expect(result.content[0].text).toContain("Template setup skipped");
      expect(result.isError).toBeUndefined();

      // Verify directory was created
      const planDir = path.join(testDir, "_mcp-interactive-instruction/plan");
      const stat = await fs.stat(planDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should succeed even if directory already exists", async () => {
      // Pre-create the directory
      const planDir = path.join(testDir, "_mcp-interactive-instruction/plan");
      await fs.mkdir(planDir, { recursive: true });

      const actionParams: ApproveActionParams = { target: "skip_templates" };
      const result = await handler.execute({ actionParams, context: mockContext });

      expect(result.content[0].text).toContain("Created empty plan directory");
      expect(result.isError).toBeUndefined();
    });

    it("should return error when directory creation fails", async () => {
      // Make the directory read-only to cause an error
      const readOnlyDir = path.join(testDir, "readonly");
      await fs.mkdir(readOnlyDir, { mode: 0o444 });

      const errorContext: ApproveActionContext = {
        ...mockContext,
        markdownDir: path.join(readOnlyDir, "nested/dir"),
      };

      const actionParams: ApproveActionParams = { target: "skip_templates" };
      const result = await handler.execute({ actionParams, context: errorContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error creating directory");

      // Cleanup
      await fs.chmod(readOnlyDir, 0o755);
    });
  });
});
