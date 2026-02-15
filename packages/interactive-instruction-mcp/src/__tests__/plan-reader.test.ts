import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PlanReader } from "../services/plan-reader.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const tempDir = path.join(process.cwd(), "src/__tests__/temp-plan");

describe("PlanReader", () => {
  let reader: PlanReader;

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    reader = new PlanReader(tempDir);
  });

  afterEach(async () => {
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file));
      }
      await fs.rmdir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===================
  // Basic CRUD Tests
  // ===================
  describe("addTask", () => {
    it("should create a new task", async () => {
      const result = await reader.addTask({
        id: "task-1",
        title: "Test Task",
        content: "Task content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done when tested",
        deliverables: ["output.txt"],
        is_parallelizable: false,
        references: [],
      });

      expect(result.success).toBe(true);
      expect(result.path).toContain("task-1.md");
    });

    it("should reject duplicate task id", async () => {
      await reader.addTask({
        id: "task-1",
        title: "First Task",
        content: "Content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.addTask({
        id: "task-1",
        title: "Duplicate Task",
        content: "Content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });
  });

  describe("getTask", () => {
    it("should return task by id", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Test Task",
        content: "Content here",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "Prereq",
        completion_criteria: "Criteria",
        deliverables: ["file.txt"],
        is_parallelizable: true,
        references: ["doc-1"],
      });

      const task = await reader.getTask("task-1");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-1");
      expect(task?.title).toBe("Test Task");
      expect(task?.content).toBe("Content here");
      expect(task?.prerequisites).toBe("Prereq");
      expect(task?.deliverables).toEqual(["file.txt"]);
      expect(task?.is_parallelizable).toBe(true);
      expect(task?.references).toEqual(["doc-1"]);
    });

    it("should return null for non-existent task", async () => {
      const task = await reader.getTask("non-existent");
      expect(task).toBeNull();
    });
  });

  describe("listTasks", () => {
    it("should return empty array when no tasks", async () => {
      const tasks = await reader.listTasks();
      expect(tasks).toEqual([]);
    });

    it("should list all tasks", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Task 1",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "task-2",
        title: "Task 2",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: true,
        references: [],
      });

      const tasks = await reader.listTasks();

      expect(tasks.length).toBe(2);
      expect(tasks.map((t) => t.id).sort()).toEqual(["task-1", "task-2"]);
    });
  });

  describe("updateTask", () => {
    it("should update task fields", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Original",
        content: "Original content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.updateTask({
        id: "task-1",
        title: "Updated",
        content: "Updated content",
      });

      expect(result.success).toBe(true);

      const task = await reader.getTask("task-1");
      expect(task?.title).toBe("Updated");
      expect(task?.content).toBe("Updated content");
    });

    it("should return error for non-existent task", async () => {
      const result = await reader.updateTask({
        id: "non-existent",
        title: "New Title",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("deleteTask", () => {
    it("should delete existing task", async () => {
      await reader.addTask({
        id: "task-1",
        title: "To Delete",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.deleteTask("task-1");
      expect(result.success).toBe(true);

      const task = await reader.getTask("task-1");
      expect(task).toBeNull();
    });

    it("should prevent deleting task with dependents", async () => {
      await reader.addTask({
        id: "parent-task",
        title: "Parent",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "child-task",
        title: "Child",
        content: "",
        parent: "",
        dependencies: ["parent-task"],
        dependency_reason: "Needs parent",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.deleteTask("parent-task");

      expect(result.success).toBe(false);
      expect(result.error).toContain("depend on this");
    });
  });

  describe("clearAllTasks", () => {
    it("should remove all tasks", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Task 1",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "task-2",
        title: "Task 2",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.clearAllTasks();

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);

      const tasks = await reader.listTasks();
      expect(tasks.length).toBe(0);
    });
  });

  describe("validateDependencies", () => {
    it("should detect missing dependencies", async () => {
      const result = await reader.validateDependencies({
        taskId: "new-task",
        dependencies: ["non-existent"],
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing dependencies");
    });

    it("should accept valid dependencies", async () => {
      await reader.addTask({
        id: "dep-task",
        title: "Dependency",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.validateDependencies({
        taskId: "new-task",
        dependencies: ["dep-task"],
      });

      expect(result.valid).toBe(true);
    });
  });

  // ===================
  // New Features Tests
  // ===================
  describe("parent field", () => {
    it("should create task with parent", async () => {
      await reader.addTask({
        id: "parent-task",
        title: "Parent",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.addTask({
        id: "child-task",
        title: "Child",
        content: "",
        parent: "parent-task",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      expect(result.success).toBe(true);

      const child = await reader.getTask("child-task");
      expect(child?.parent).toBe("parent-task");
    });

    it("should reject task with non-existent parent", async () => {
      const result = await reader.addTask({
        id: "orphan-task",
        title: "Orphan",
        content: "",
        parent: "non-existent-parent",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Parent task");
      expect(result.error).toContain("not found");
    });
  });

  describe("getChildTasks", () => {
    it("should return child tasks", async () => {
      await reader.addTask({
        id: "parent",
        title: "Parent",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "child-1",
        title: "Child 1",
        content: "",
        parent: "parent",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "child-2",
        title: "Child 2",
        content: "",
        parent: "parent",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const children = await reader.getChildTasks("parent");

      expect(children.length).toBe(2);
      expect(children.map((c) => c.id).sort()).toEqual(["child-1", "child-2"]);
    });

    it("should return empty array for task with no children", async () => {
      await reader.addTask({
        id: "lonely-task",
        title: "Lonely",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const children = await reader.getChildTasks("lonely-task");
      expect(children).toEqual([]);
    });
  });

  describe("deliverables and output", () => {
    it("should store deliverables", async () => {
      await reader.addTask({
        id: "task-with-deliverables",
        title: "Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: ["doc.md", "code.ts", "test.ts"],
        is_parallelizable: false,
        references: [],
      });

      const task = await reader.getTask("task-with-deliverables");
      expect(task?.deliverables).toEqual(["doc.md", "code.ts", "test.ts"]);
    });

    it("should store output when completing", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await reader.updateStatus({
        id: "task-1",
        status: "completed",
        output: "src/task.ts:1-50 完了. 完了条件を満たす.",
      });

      const task = await reader.getTask("task-1");
      expect(task?.output).toBe("src/task.ts:1-50 完了. 完了条件を満たす.");
    });
  });

  describe("updateStatus", () => {
    it("should convert completed to pending_review", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.updateStatus({
        id: "task-1",
        status: "completed",
        output: "src/file.ts:1-10 完了.",
      });

      expect(result.success).toBe(true);
      expect(result.actualStatus).toBe("pending_review");

      const task = await reader.getTask("task-1");
      expect(task?.status).toBe("pending_review");
    });

    it("should block starting task with incomplete dependencies", async () => {
      await reader.addTask({
        id: "dep-task",
        title: "Dependency",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "main-task",
        title: "Main",
        content: "",
        parent: "",
        dependencies: ["dep-task"],
        dependency_reason: "Needs dep",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.updateStatus({
        id: "main-task",
        status: "in_progress",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("dependencies not completed");
    });
  });

  describe("approveTask", () => {
    it("should approve pending_review task", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.updateStatus({
        id: "task-1",
        status: "completed",
        output: "src/file.ts:1-10 完了.",
      });

      const result = await reader.approveTask("task-1");

      expect(result.success).toBe(true);

      const task = await reader.getTask("task-1");
      expect(task?.status).toBe("completed");
    });

    it("should reject approving non-pending_review task", async () => {
      await reader.addTask({
        id: "task-1",
        title: "Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const result = await reader.approveTask("task-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not pending review");
    });

    it("should block approval when child tasks incomplete", async () => {
      await reader.addTask({
        id: "parent",
        title: "Parent",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "child",
        title: "Child",
        content: "",
        parent: "parent",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      // Set parent to pending_review
      await reader.updateStatus({
        id: "parent",
        status: "completed",
        output: "src/parent.ts:1-20 完了.",
      });

      // Try to approve parent - should fail
      const result = await reader.approveTask("parent");

      expect(result.success).toBe(false);
      expect(result.error).toContain("child tasks not finished");
    });

    it("should allow approval when all child tasks completed", async () => {
      await reader.addTask({
        id: "parent",
        title: "Parent",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "child",
        title: "Child",
        content: "",
        parent: "parent",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      // Complete child first
      await reader.updateStatus({
        id: "child",
        status: "completed",
        output: "src/child.ts:1-15 完了.",
      });
      await reader.approveTask("child");

      // Now complete parent
      await reader.updateStatus({
        id: "parent",
        status: "completed",
        output: "src/parent.ts:1-20 完了.",
      });

      const result = await reader.approveTask("parent");

      expect(result.success).toBe(true);

      const parent = await reader.getTask("parent");
      expect(parent?.status).toBe("completed");
    });
  });

  describe("getReadyTasks and getBlockedTasks", () => {
    it("should identify ready tasks", async () => {
      await reader.addTask({
        id: "ready-task",
        title: "Ready",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const ready = await reader.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain("ready-task");
    });

    it("should identify blocked tasks", async () => {
      await reader.addTask({
        id: "dep",
        title: "Dependency",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });
      await reader.addTask({
        id: "blocked",
        title: "Blocked",
        content: "",
        parent: "",
        dependencies: ["dep"],
        dependency_reason: "Needs dep",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      const blocked = await reader.getBlockedTasks();
      expect(blocked.map((t) => t.id)).toContain("blocked");
    });
  });
});
