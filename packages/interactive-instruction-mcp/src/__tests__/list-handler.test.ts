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

      await handler.execute({ rawParams, context: mockContext });

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
      await handler.execute({ rawParams, context: mockContext });

      expect(callOrder).toEqual(["updateAll", "listTasks"]);
    });

    it("should return no tasks message when empty", async () => {
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

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
          parallelizable_with: [],
        },
      ];

      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getReadyTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.formatTaskList).mockReturnValue("| task-1 | Test Task |");

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("# Task Plan"),
      });
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("1 total"),
      });
    });
  });
});
