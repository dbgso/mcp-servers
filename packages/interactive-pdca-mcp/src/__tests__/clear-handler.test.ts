import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClearHandler } from "../tools/plan/handlers/clear-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, PlanReporter } from "../types/index.js";

describe("ClearHandler", () => {
  let handler: ClearHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new ClearHandler();

    mockPlanReader = {
      listTasks: vi.fn().mockResolvedValue([]),
      clearAllTasks: vi.fn().mockResolvedValue({ success: true, count: 0 }),
    } as unknown as PlanReader;

    mockPlanReporter = {
      updateAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlanReporter;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: mockPlanReporter,
      feedbackReader: {} as PlanActionContext["feedbackReader"],
      planDir: "/tmp/mcp-interactive-instruction-plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("action property", () => {
    it("should have action 'clear'", () => {
      expect(handler.action).toBe("clear");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan clear");
      expect(handler.help).toContain("plan(action: \"clear\")");
    });
  });

  describe("execute", () => {
    it("should return 'no tasks' message when list is empty", async () => {
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "No tasks to clear.",
      });
      expect(mockPlanReader.clearAllTasks).not.toHaveBeenCalled();
    });

    it("should clear tasks and return count when tasks exist", async () => {
      const mockTasks = [
        { id: "task-1", title: "Task 1", status: "pending", dependencies: [], is_parallelizable: false, parent: "" },
        { id: "task-2", title: "Task 2", status: "pending", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.clearAllTasks).mockResolvedValue({ success: true, count: 2 });

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "Cleared 2 tasks. Plan is now empty.",
      });
      expect(mockPlanReader.clearAllTasks).toHaveBeenCalledTimes(1);
      expect(mockPlanReporter.updateAll).toHaveBeenCalledTimes(1);
    });

    it("should return error when clearAllTasks fails", async () => {
      const mockTasks = [
        { id: "task-1", title: "Task 1", status: "pending", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.clearAllTasks).mockResolvedValue({ success: false, error: "File system error" });

      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "Error: File system error",
      });
    });

    it("should return error for invalid params", async () => {
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
      expect(result.content[0].text).toContain("# plan clear");
    });
  });
});
