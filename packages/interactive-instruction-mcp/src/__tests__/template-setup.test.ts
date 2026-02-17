import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  setupSelfReviewTemplates,
  needsTemplateSetup,
} from "../services/template-setup.js";

describe("template-setup", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "template-setup-test-"));
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("needsTemplateSetup", () => {
    it("returns true when plan directory does not exist", async () => {
      const result = await needsTemplateSetup(testDir);
      expect(result).toBe(true);
    });

    it("returns false when plan directory exists", async () => {
      const planDir = path.join(testDir, "_mcp-interactive-instruction/plan");
      await fs.mkdir(planDir, { recursive: true });

      const result = await needsTemplateSetup(testDir);
      expect(result).toBe(false);
    });
  });

  describe("setupSelfReviewTemplates", () => {
    it("copies templates when plan directory does not exist", async () => {
      const result = await setupSelfReviewTemplates(testDir);

      expect(result.action).toBe("copied_templates");
      expect(result.path).toContain("self-review");

      // Verify templates were copied
      const selfReviewDir = path.join(testDir, "_mcp-interactive-instruction/plan/self-review");
      const stat = await fs.stat(selfReviewDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("copies templates when plan directory exists", async () => {
      // Create plan directory to indicate user has opted in
      const planDir = path.join(testDir, "_mcp-interactive-instruction/plan");
      await fs.mkdir(planDir, { recursive: true });

      const result = await setupSelfReviewTemplates(testDir);

      expect(result.action).toBe("copied_templates");
      expect(result.path).toContain("self-review");

      // Verify templates were copied
      const selfReviewDir = path.join(planDir, "self-review");
      const files = await fs.readdir(selfReviewDir);
      expect(files).toContain("plan.md");
      expect(files).toContain("do.md");
      expect(files).toContain("check.md");
      expect(files).toContain("act.md");
    });

    it("returns already_exists when self-review templates exist", async () => {
      // Create plan directory and self-review with a file
      const selfReviewDir = path.join(
        testDir,
        "_mcp-interactive-instruction/plan/self-review"
      );
      await fs.mkdir(selfReviewDir, { recursive: true });
      await fs.writeFile(path.join(selfReviewDir, "plan.md"), "# Test");

      const result = await setupSelfReviewTemplates(testDir);

      expect(result.action).toBe("already_exists");
    });

    it("copies templates when self-review directory exists but is empty", async () => {
      // Create empty self-review directory
      const selfReviewDir = path.join(
        testDir,
        "_mcp-interactive-instruction/plan/self-review"
      );
      await fs.mkdir(selfReviewDir, { recursive: true });

      const result = await setupSelfReviewTemplates(testDir);

      expect(result.action).toBe("copied_templates");
    });

    it("template files contain expected content", async () => {
      // Create plan directory
      const planDir = path.join(testDir, "_mcp-interactive-instruction/plan");
      await fs.mkdir(planDir, { recursive: true });

      await setupSelfReviewTemplates(testDir);

      // Check plan.md content
      const planContent = await fs.readFile(
        path.join(planDir, "self-review/plan.md"),
        "utf-8"
      );
      expect(planContent).toContain("# Self-Review: Plan Phase");
      expect(planContent).toContain("Unclear Points");
      expect(planContent).toContain("Concerns");

      // Check do.md content
      const doContent = await fs.readFile(
        path.join(planDir, "self-review/do.md"),
        "utf-8"
      );
      expect(doContent).toContain("# Self-Review: Do Phase");
      expect(doContent).toContain("design_decisions");

      // Check check.md content
      const checkContent = await fs.readFile(
        path.join(planDir, "self-review/check.md"),
        "utf-8"
      );
      expect(checkContent).toContain("# Self-Review: Check Phase");
      expect(checkContent).toContain("test_results");

      // Check act.md content
      const actContent = await fs.readFile(
        path.join(planDir, "self-review/act.md"),
        "utf-8"
      );
      expect(actContent).toContain("# Self-Review: Act Phase");
      expect(actContent).toContain("Knowledge Proposal");
    });

    it("copies nested subdirectories when they exist in templates", async () => {
      // Create plan directory
      const planDir = path.join(testDir, "_mcp-interactive-instruction/plan");
      await fs.mkdir(planDir, { recursive: true });

      await setupSelfReviewTemplates(testDir);

      // Check that examples subdirectory was copied
      const examplesDir = path.join(planDir, "self-review/examples");
      const stat = await fs.stat(examplesDir);
      expect(stat.isDirectory()).toBe(true);

      // Check that example.md was copied
      const exampleContent = await fs.readFile(
        path.join(examplesDir, "example.md"),
        "utf-8"
      );
      expect(exampleContent).toContain("# Example");
    });
  });
});
