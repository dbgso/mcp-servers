import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PlanReader } from "../services/plan-reader.js";
import { PlanReporter } from "../services/plan-reporter.js";

describe("PlanReporter", () => {
  let testDir: string;
  let planReader: PlanReader;
  let planReporter: PlanReporter;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `plan-reporter-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    planReader = new PlanReader(testDir);
    planReporter = new PlanReporter(testDir, planReader);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("updatePendingReviewFile", () => {
    it("should create PENDING_REVIEW.md with no tasks message when empty", async () => {
      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("# Pending Review Tasks");
      expect(content).toContain("No tasks pending review");
    });

    it("should include pending_review tasks in the file", async () => {
      await planReader.addTask({
        id: "test-task",
        title: "Test Task",
        content: "Test content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Tests pass",
        deliverables: ["code.ts", "test.ts"],
        is_parallelizable: false,
        references: [],
      });

      // Change to pending_review with structured data
      await planReader.updateStatus({
        id: "test-task",
        status: "completed",
        output: "src/test.ts:1-10 テスト追加",
        changes: [
          { file: "src/test.ts", lines: "1-10", description: "テスト追加" },
        ],
        why: "完了条件を満たす",
        references_used: null,
        references_reason: "参照不要",
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("test-task");
      expect(content).toContain("Test Task");
      expect(content).toContain("src/test.ts");
      expect(content).toContain("1-10");
      expect(content).toContain("Tests pass");
      expect(content).toContain("完了条件を満たす");
    });

    it("should not include completed tasks", async () => {
      await planReader.addTask({
        id: "completed-task",
        title: "Completed Task",
        content: "Done",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["file.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "completed-task",
        status: "completed",
        output: "src/completed.ts:1-10 完了.",
      });

      // Approve to make it completed
      await planReader.approveTask("completed-task");

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).not.toContain("completed-task");
    });
  });

  describe("updateGraphFile", () => {
    it("should create GRAPH.md with mermaid diagram", async () => {
      await planReader.addTask({
        id: "task-a",
        title: "Task A",
        content: "First task",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["a.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("# Task Graph");
      expect(content).toContain("```mermaid");
      expect(content).toContain("flowchart LR");
      expect(content).toContain("task_a");
      expect(content).toContain("Task A");
    });

    it("should show dependencies as arrows", async () => {
      await planReader.addTask({
        id: "task-a",
        title: "Task A",
        content: "First",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["a.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.addTask({
        id: "task-b",
        title: "Task B",
        content: "Depends on A",
        parent: "",
        dependencies: ["task-a"],
        dependency_reason: "Needs A first",
        prerequisites: "A done",
        completion_criteria: "Done",
        deliverables: ["b.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("task_a --> task_b");
    });

    it("should show status icons", async () => {
      await planReader.addTask({
        id: "pending-task",
        title: "Pending",
        content: "Not started",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["p.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.addTask({
        id: "done-task",
        title: "Done",
        content: "Finished",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["d.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "done-task",
        status: "completed",
        output: "src/done.ts:1-10 完了.",
      });
      await planReader.approveTask("done-task");

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("○"); // pending
      expect(content).toContain("✓"); // completed
    });
  });

  describe("updateAll", () => {
    it("should update both files", async () => {
      await planReader.addTask({
        id: "test-task",
        title: "Test",
        content: "Content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["test.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateAll();

      const pendingReview = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      const graph = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );

      expect(pendingReview).toContain("# Pending Review Tasks");
      expect(graph).toContain("# Task Graph");
    });
  });
});
