import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReadHandler } from "../tools/plan/handlers/read-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, Task } from "../types/index.js";

describe("ReadHandler", () => {
  let handler: ReadHandler;
  let mockPlanReader: PlanReader;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new ReadHandler();

    mockPlanReader = {
      getTask: vi.fn().mockResolvedValue(null),
    } as unknown as PlanReader;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: {} as PlanActionContext["planReporter"],
      feedbackReader: {} as PlanActionContext["feedbackReader"],
      planDir: "/tmp/mcp-interactive-instruction-plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("action property", () => {
    it("should have action 'read'", () => {
      expect(handler.action).toBe("read");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan read");
      expect(handler.help).toContain("plan(action: \"read\", id:");
    });
  });

  describe("execute", () => {
    it("should return error for missing id", async () => {
      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });

    it("should return error when task not found", async () => {
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(null);

      const rawParams: PlanRawParams = { id: "non-existent" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Task "non-existent" not found');
    });

    it("should return task details when found", async () => {
      const mockTask: Task = {
        id: "task-1",
        title: "Test Task",
        content: "This is the task content",
        status: "pending",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "All tests pass",
        deliverables: ["Report"],
        output: "",
        task_output: null,
        is_parallelizable: false,
        references: ["doc-1"],
        feedback: [],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-1" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("# Task: Test Task");
      expect(text).toContain("**ID:** task-1");
      expect(text).toContain("**Status:** pending");
      expect(text).toContain("**Parent:** (root)");
      expect(text).toContain("**Dependencies:** none");
      expect(text).toContain("**Prerequisites:** None");
      expect(text).toContain("**Completion Criteria:** All tests pass");
      expect(text).toContain("**Deliverables:** Report");
      expect(text).toContain("**References:** doc-1");
      expect(text).toContain("This is the task content");
    });

    it("should show dependencies when present", async () => {
      const mockTask: Task = {
        id: "task-2",
        title: "Dependent Task",
        content: "Content",
        status: "pending",
        parent: "parent-task",
        dependencies: ["dep-1", "dep-2"],
        dependency_reason: "These must complete first",
        prerequisites: "N/A",
        completion_criteria: "Done",
        deliverables: [],
        output: "",
        task_output: null,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-2" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("**Parent:** parent-task");
      expect(text).toContain("**Dependencies:** dep-1, dep-2");
      expect(text).toContain("**Dependency Reason:** These must complete first");
    });

    it("should show feedback history when present", async () => {
      const mockTask: Task = {
        id: "task-3",
        title: "Task with Feedback",
        content: "Content",
        status: "pending",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "Completed output",
        task_output: null,
        is_parallelizable: false,
        references: [],
        feedback: [
          { comment: "Good work", decision: "adopted", timestamp: "2025-01-01T10:00:00Z" },
          { comment: "Needs revision", decision: "rejected", timestamp: "2025-01-01T11:00:00Z" },
        ],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-3" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## Feedback History");
      expect(text).toContain("✅ **adopted**");
      expect(text).toContain("Good work");
      expect(text).toContain("❌ **rejected**");
      expect(text).toContain("Needs revision");
    });

    it("should show parallelizable info when true", async () => {
      const mockTask: Task = {
        id: "parallel-task",
        title: "Parallel Task",
        content: "Content",
        status: "pending",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: null,
        is_parallelizable: true,
        parallelizable_units: ["unit-a", "unit-b"],
        references: [],
        feedback: [],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "parallel-task" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("**Parallelizable:**");
      expect(text).toContain("unit-a");
      expect(text).toContain("unit-b");
    });

    it("should return error for invalid params", async () => {
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });
  });
});
