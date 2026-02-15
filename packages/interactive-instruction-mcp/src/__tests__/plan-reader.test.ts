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
    type ValidateDependenciesTestCase = {
      name: string;
      needsSetup: boolean;
      taskId: string;
      dependencies: string[];
      expectedValid: boolean;
      expectedErrorContains?: string;
    };

    const validateDependenciesTestCases: ValidateDependenciesTestCase[] = [
      {
        name: "missing dependencies",
        needsSetup: false,
        taskId: "new-task",
        dependencies: ["non-existent"],
        expectedValid: false,
        expectedErrorContains: "Missing dependencies",
      },
      {
        name: "valid dependencies",
        needsSetup: true,
        taskId: "new-task",
        dependencies: ["dep-task"],
        expectedValid: true,
      },
    ];

    it.each(validateDependenciesTestCases)(
      "should handle $name",
      async ({ needsSetup, taskId, dependencies, expectedValid, expectedErrorContains }) => {
        if (needsSetup) {
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
        }
        const result = await reader.validateDependencies({ taskId, dependencies });

        expect(result.valid).toBe(expectedValid);
        if (expectedErrorContains) {
          expect(result.error).toContain(expectedErrorContains);
        }
      }
    );
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

    it("should mark task as ready when dependencies are completed", async () => {
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
        id: "waiting-task",
        title: "Waiting",
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

      // Initially blocked
      let blocked = await reader.getBlockedTasks();
      expect(blocked.map((t) => t.id)).toContain("waiting-task");

      // Complete the dependency
      await reader.updateStatus({
        id: "dep-task",
        status: "completed",
        output: "Done",
      });
      await reader.approveTask("dep-task");

      // Now should be ready
      const ready = await reader.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain("waiting-task");

      blocked = await reader.getBlockedTasks();
      expect(blocked.map((t) => t.id)).not.toContain("waiting-task");
    });
  });

  describe("addFeedback", () => {
    it("should add feedback to a task", async () => {
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

      const result = await reader.addFeedback({
        id: "task-1",
        comment: "Please fix the edge case",
        decision: "adopted",
      });

      expect(result.success).toBe(true);

      const task = await reader.getTask("task-1");
      expect(task?.feedback).toHaveLength(1);
      expect(task?.feedback[0].comment).toBe("Please fix the edge case");
      expect(task?.feedback[0].decision).toBe("adopted");
      expect(task?.feedback[0].timestamp).toBeDefined();
    });

    it("should add multiple feedback entries", async () => {
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

      await reader.addFeedback({
        id: "task-1",
        comment: "First feedback",
        decision: "adopted",
      });

      await reader.addFeedback({
        id: "task-1",
        comment: "Second feedback",
        decision: "rejected",
      });

      const task = await reader.getTask("task-1");
      expect(task?.feedback).toHaveLength(2);
      expect(task?.feedback[0].comment).toBe("First feedback");
      expect(task?.feedback[1].comment).toBe("Second feedback");
      expect(task?.feedback[1].decision).toBe("rejected");
    });

    it("should return error for non-existent task", async () => {
      const result = await reader.addFeedback({
        id: "non-existent",
        comment: "Feedback",
        decision: "adopted",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("validateDependencies - circular detection", () => {
    type CircularDependencyTestCase = {
      name: string;
      setupType: "direct" | "indirect";
      taskId: string;
      dependencies: string[];
    };

    const circularDependencyTestCases: CircularDependencyTestCase[] = [
      {
        name: "direct circular dependency (self-reference)",
        setupType: "direct",
        taskId: "task-a",
        dependencies: ["task-a"],
      },
      {
        name: "indirect circular dependency (A -> C -> B -> A)",
        setupType: "indirect",
        taskId: "task-a",
        dependencies: ["task-c"],
      },
    ];

    it.each(circularDependencyTestCases)(
      "should detect $name",
      async ({ setupType, taskId, dependencies }) => {
        // Setup tasks based on type
        await reader.addTask({
          id: "task-a",
          title: "Task A",
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

        if (setupType === "indirect") {
          await reader.addTask({
            id: "task-b",
            title: "Task B",
            content: "",
            parent: "",
            dependencies: ["task-a"],
            dependency_reason: "Depends on A",
            prerequisites: "",
            completion_criteria: "",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          });
          await reader.addTask({
            id: "task-c",
            title: "Task C",
            content: "",
            parent: "",
            dependencies: ["task-b"],
            dependency_reason: "Depends on B",
            prerequisites: "",
            completion_criteria: "",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          });
        }

        const result = await reader.validateDependencies({ taskId, dependencies });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Circular dependency");
      }
    );
  });

  describe("formatTaskList", () => {
    type FormatTaskListTestCase = {
      name: string;
      tasks: Parameters<PlanReader["formatTaskList"]>[0];
      expectedContains: string[];
      expectedEquals?: string;
    };

    const formatTaskListTestCases: FormatTaskListTestCase[] = [
      {
        name: "empty list",
        tasks: [],
        expectedContains: [],
        expectedEquals: "No tasks.",
      },
      {
        name: "single task",
        tasks: [
          {
            id: "task-1",
            title: "Task One",
            status: "pending",
            parent: "",
            dependencies: [],
            is_parallelizable: false,
          },
        ],
        expectedContains: ["| ID |", "| task-1 |", "Task One", "pending", "no"],
      },
      {
        name: "multiple tasks with dependencies",
        tasks: [
          {
            id: "task-1",
            title: "Task One",
            status: "completed",
            parent: "",
            dependencies: [],
            is_parallelizable: true,
          },
          {
            id: "task-2",
            title: "Task Two",
            status: "in_progress",
            parent: "",
            dependencies: ["task-1"],
            is_parallelizable: false,
          },
        ],
        expectedContains: ["task-1", "task-2", "yes"],
      },
    ];

    it.each(formatTaskListTestCases)(
      "should format $name correctly",
      ({ tasks, expectedContains, expectedEquals }) => {
        const result = reader.formatTaskList(tasks);

        if (expectedEquals !== undefined) {
          expect(result).toBe(expectedEquals);
        }
        for (const expected of expectedContains) {
          expect(result).toContain(expected);
        }
      }
    );
  });

  describe("updateTask with dependencies", () => {
    it("should validate new dependencies when updating", async () => {
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

      // Try to update with non-existent dependency
      const result = await reader.updateTask({
        id: "task-1",
        dependencies: ["non-existent"],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing dependencies");
    });
  });

  describe("non-existent task error handling", () => {
    type NonExistentTaskTestCase = {
      operation: string;
    };

    const nonExistentTaskTestCases: NonExistentTaskTestCase[] = [
      { operation: "updateStatus" },
      { operation: "approveTask" },
      { operation: "deleteTask" },
    ];

    it.each(nonExistentTaskTestCases)(
      "should return error for $operation when task not found",
      async ({ operation }) => {
        let result: { success: boolean; error?: string };

        switch (operation) {
          case "updateStatus":
            result = await reader.updateStatus({
              id: "non-existent",
              status: "in_progress",
            });
            break;
          case "approveTask":
            result = await reader.approveTask("non-existent");
            break;
          case "deleteTask":
            result = await reader.deleteTask("non-existent");
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
      }
    );
  });

  describe("addTask with invalid dependencies", () => {
    it("should reject task with non-existent dependencies", async () => {
      const result = await reader.addTask({
        id: "new-task",
        title: "New Task",
        content: "",
        parent: "",
        dependencies: ["non-existent-dep"],
        dependency_reason: "Need this",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing dependencies");
    });
  });

  describe("validateDependencies - already visited node", () => {
    it("should handle diamond dependency pattern (not circular)", async () => {
      // Create A, B depends on A, C depends on A, D depends on B and C
      // This tests the visited.has(id) branch
      await reader.addTask({
        id: "task-a",
        title: "Task A",
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
        id: "task-b",
        title: "Task B",
        content: "",
        parent: "",
        dependencies: ["task-a"],
        dependency_reason: "Depends on A",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await reader.addTask({
        id: "task-c",
        title: "Task C",
        content: "",
        parent: "",
        dependencies: ["task-a"],
        dependency_reason: "Depends on A",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      // This should validate successfully (diamond pattern, not circular)
      const result = await reader.validateDependencies({
        taskId: "task-d",
        dependencies: ["task-b", "task-c"],
      });

      expect(result.valid).toBe(true);
    });

    it("should handle dependency on task with no dependencies (uses empty array fallback)", async () => {
      // Create task without dependencies array in file (simulating edge case)
      // This tests the `tasks.get(id)?.dependencies || []` branch
      await reader.addTask({
        id: "dep-task",
        title: "Dep Task",
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

      // Validate new task depending on existing task
      const result = await reader.validateDependencies({
        taskId: "new-task",
        dependencies: ["dep-task"],
      });

      expect(result.valid).toBe(true);
    });
  });

  describe("getReadyTasks - edge cases", () => {
    it("should not include tasks with incomplete dependencies", async () => {
      // Create a dependency task that is NOT completed
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

      // Create a task that depends on the uncompleted dependency
      await reader.addTask({
        id: "dependent",
        title: "Dependent",
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

      // The dependent task should NOT be in ready tasks
      const ready = await reader.getReadyTasks();
      expect(ready.map((t) => t.id)).not.toContain("dependent");
    });

    it("should include tasks with all dependencies completed", async () => {
      // Create and complete a dependency task
      await reader.addTask({
        id: "dep-complete",
        title: "Completed Dependency",
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
        id: "dep-complete",
        status: "completed",
        output: "Done",
      });
      await reader.approveTask("dep-complete");

      // Create a task that depends on the completed dependency
      await reader.addTask({
        id: "ready-task",
        title: "Ready Task",
        content: "",
        parent: "",
        dependencies: ["dep-complete"],
        dependency_reason: "Needs dep",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      // The dependent task should be in ready tasks
      const ready = await reader.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain("ready-task");
    });
  });

  describe("clearAllTasks - edge cases", () => {
    it("should skip non-.md files when clearing tasks", async () => {
      // Create a task
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

      // Create a non-.md file in the directory
      await fs.writeFile(path.join(tempDir, "other.txt"), "other file", "utf-8");

      const result = await reader.clearAllTasks();

      // Should only count .md files
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);

      // The non-.md file should still exist
      const files = await fs.readdir(tempDir);
      expect(files).toContain("other.txt");
    });
  });

  describe("parseTaskFile - edge cases", () => {
    it("should return null for task_output when not a string in metadata", async () => {
      // Create a task file with task_output that's not a valid JSON string
      const taskContent = `---
id: test-task
title: "Test Task"
status: pending
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: ""
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(path.join(tempDir, "test-task.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("test-task");
      expect(task?.task_output).toBeNull();
    });

    it("should return empty array when feedback is invalid JSON", async () => {
      const taskContent = `---
id: invalid-feedback-task
title: "Invalid Feedback Task"
status: pending
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "null"
is_parallelizable: false
references: []
feedback: "not valid json"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(path.join(tempDir, "invalid-feedback-task.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("invalid-feedback-task");
      expect(task?.feedback).toEqual([]);
    });

    it("should return null when task_output is invalid JSON", async () => {
      const taskContent = `---
id: invalid-output-task
title: "Invalid Output Task"
status: pending
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "not valid json {{"
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(path.join(tempDir, "invalid-output-task.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("invalid-output-task");
      expect(task?.task_output).toBeNull();
    });

    it("should return null for malformed task file without frontmatter", async () => {
      const taskContent = `No frontmatter here, just content`;

      await fs.writeFile(path.join(tempDir, "no-frontmatter.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("no-frontmatter");
      expect(task).toBeNull();
    });

    it("should return null for task file with missing required fields", async () => {
      const taskContent = `---
title: "Only Title"
---

Content`;

      await fs.writeFile(path.join(tempDir, "missing-fields.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("missing-fields");
      expect(task).toBeNull();
    });

    it("should parse array values without quotes", async () => {
      const taskContent = `---
id: array-task
title: "Array Task"
status: pending
parent: ""
dependencies: [dep1, dep2, dep3]
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: [file1.ts, file2.ts]
output: ""
task_output: "null"
is_parallelizable: false
references: [ref1, ref2]
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(path.join(tempDir, "array-task.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("array-task");
      expect(task?.dependencies).toEqual(["dep1", "dep2", "dep3"]);
      expect(task?.deliverables).toEqual(["file1.ts", "file2.ts"]);
      expect(task?.references).toEqual(["ref1", "ref2"]);
    });

    it("should parse single quoted string values", async () => {
      const taskContent = `---
id: quoted-task
title: 'Single Quoted Title'
status: pending
parent: ''
dependencies: []
dependency_reason: ''
prerequisites: 'Some prereqs'
completion_criteria: ''
deliverables: []
output: ''
task_output: "null"
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(path.join(tempDir, "quoted-task.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("quoted-task");
      expect(task?.title).toBe("Single Quoted Title");
      expect(task?.prerequisites).toBe("Some prereqs");
    });

    it("should handle empty feedback string", async () => {
      const taskContent = `---
id: empty-feedback-task
title: "Empty Feedback"
status: pending
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "null"
is_parallelizable: false
references: []
feedback: ""
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(path.join(tempDir, "empty-feedback-task.md"), taskContent, "utf-8");
      reader.invalidateCache();

      const task = await reader.getTask("empty-feedback-task");
      expect(task?.feedback).toEqual([]);
    });
  });
});
