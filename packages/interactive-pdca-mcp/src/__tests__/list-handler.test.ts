import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListHandler } from "../tools/plan/handlers/list-handler.js";
import type { PlanActionContext, PlanRawParams, TaskSummary, PlanReader, PlanReporter } from "../types/index.js";

describe("ListHandler", () => {
  let handler: ListHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new ListHandler();

    mockPlanReader = {
      listTasks: vi.fn().mockResolvedValue([]),
      getBlockedTasks: vi.fn().mockResolvedValue([]),
      getReadyTasks: vi.fn().mockResolvedValue([]),
      getTask: vi.fn().mockResolvedValue(null),
      formatTaskList: vi.fn().mockReturnValue(""),
    } as unknown as PlanReader;

    mockPlanReporter = {
      updateAll: vi.fn().mockResolvedValue(undefined),
      updatePendingReviewFile: vi.fn().mockResolvedValue(undefined),
      updateGraphFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlanReporter;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: mockPlanReporter,
      feedbackReader: {} as PlanActionContext["feedbackReader"],
      planDir: "/tmp/mcp-interactive-instruction-plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("execute", () => {
    it("should call planReporter.updateAll() to sync markdown files", async () => {
      const rawParams: PlanRawParams = {};

      await handler.execute(rawParams, mockContext);

      expect(mockPlanReporter.updateAll).toHaveBeenCalledTimes(1);
    });

    it("should call updateAll() before listing tasks", async () => {
      const callOrder: string[] = [];

      vi.mocked(mockPlanReporter.updateAll).mockImplementation(async () => {
        callOrder.push("updateAll");
      });

      vi.mocked(mockPlanReader.listTasks).mockImplementation(async () => {
        callOrder.push("listTasks");
        return [];
      });

      const rawParams: PlanRawParams = {};
      await handler.execute(rawParams, mockContext);

      expect(callOrder).toEqual(["updateAll", "listTasks"]);
    });

    it("should return no tasks message when empty", async () => {
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("No tasks found"),
      });
    });

    it("should return task summary when tasks exist", async () => {
      const mockTasks: TaskSummary[] = [
        {
          id: "task-1",
          title: "Test Task",
          status: "pending",
          dependencies: [],
          is_parallelizable: false,
          parent: "",
        },
      ];

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("| task-1 | Test Task |");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("# Task Plan"),
      });
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("1 total"),
      });
    });

    it("should show pending_review tasks with full details", async () => {
      const mockTasks: TaskSummary[] = [
        {
          id: "review-task",
          title: "Review Task",
          status: "pending_review",
          dependencies: [],
          is_parallelizable: false,
          parent: "",
        },
      ];

      const mockTask = {
        id: "review-task",
        title: "Review Task",
        status: "pending_review",
        dependencies: [],
        deliverables: ["deliverable1", "deliverable2"],
        completion_criteria: "All tests pass",
        output: "Completed successfully",
        content: "",
        parent: "",
        dependency_reason: "",
        prerequisites: "",
        task_output: null,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "",
        updated: "",
      };

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue([]);
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## Pending Review");
      expect(text).toContain("review-task");
      expect(text).toContain("deliverable1, deliverable2");
      expect(text).toContain("Completed successfully");
      expect(text).toContain("All tests pass");
      expect(text).toContain("PENDING_REVIEW.md");
      expect(text).toContain("GRAPH.md");
    });

    it("should show in_progress tasks", async () => {
      const mockTasks: TaskSummary[] = [
        {
          id: "wip-task",
          title: "Work in Progress",
          status: "in_progress",
          dependencies: [],
          is_parallelizable: false,
          parent: "",
        },
      ];

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue([]);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## In Progress");
      expect(text).toContain("wip-task");
      expect(text).toContain("Work in Progress");
    });

    it("should show blocked tasks with dependencies", async () => {
      const mockTasks: TaskSummary[] = [
        {
          id: "blocked-task",
          title: "Blocked Task",
          status: "blocked",
          dependencies: ["dep-1", "dep-2"],
          is_parallelizable: false,
          parent: "",
        },
      ];

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue([]);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## Blocked");
      expect(text).toContain("blocked-task");
      expect(text).toContain("waiting: dep-1, dep-2");
    });

    it("should show parallelizable tag for ready tasks", async () => {
      const mockTasks: TaskSummary[] = [
        {
          id: "parallel-task",
          title: "Parallel Task",
          status: "pending",
          dependencies: [],
          is_parallelizable: true,
          parallelizable_units: ["unit-a", "unit-b"],
          parent: "",
        },
      ];

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## Ready to Start");
      expect(text).toContain("[parallel: unit-a, unit-b]");
    });

    it("should return error for invalid params", async () => {
      // Pass null to trigger zod validation error
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Error:"),
      });
    });

    it("should handle pending_review task with no deliverables", async () => {
      const mockTasks: TaskSummary[] = [
        {
          id: "empty-review",
          title: "Empty Review",
          status: "pending_review",
          dependencies: [],
          is_parallelizable: false,
          parent: "",
        },
      ];

      const mockTask = {
        id: "empty-review",
        title: "Empty Review",
        status: "pending_review",
        dependencies: [],
        deliverables: [],
        completion_criteria: "",
        output: "",
        content: "",
        parent: "",
        dependency_reason: "",
        prerequisites: "",
        task_output: null,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "",
        updated: "",
      };

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue([]);
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("Deliverables: none");
      expect(text).toContain("(not recorded)");
      expect(text).toContain("(not set)");
    });
  });
});
