import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeleteHandler } from "../tools/plan/handlers/delete-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, PlanReporter } from "../types/index.js";

describe("DeleteHandler", () => {
  let handler: DeleteHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new DeleteHandler();

    mockPlanReader = {
      deleteTask: vi.fn().mockResolvedValue({ success: true }),
      cancelPendingDeletion: vi.fn().mockResolvedValue({ success: true }),
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
    it("should have action 'delete'", () => {
      expect(handler.action).toBe("delete");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan delete");
      expect(handler.help).toContain("plan(action: \"delete\"");
      expect(handler.help).toContain("force");
      expect(handler.help).toContain("cancel");
    });
  });

  describe("execute", () => {
    it("should return error for missing id", async () => {
      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });

    it("should delete single task successfully", async () => {
      vi.mocked(mockPlanReader.deleteTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = { id: "task-1" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain('Task "task-1" deleted successfully');
      expect(mockPlanReader.deleteTask).toHaveBeenCalledWith({ id: "task-1", force: undefined });
      expect(mockPlanReporter.updateAll).toHaveBeenCalled();
    });

    it("should return error when deletion fails", async () => {
      vi.mocked(mockPlanReader.deleteTask).mockResolvedValue({
        success: false,
        error: "Task has dependents",
      });

      const rawParams: PlanRawParams = { id: "task-1" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error: Task has dependents");
    });

    describe("cancel pending deletion", () => {
      it("should cancel pending deletion successfully", async () => {
        vi.mocked(mockPlanReader.cancelPendingDeletion).mockResolvedValue({ success: true });

        const rawParams: PlanRawParams = { id: "task-1", cancel: true };
        const result = await handler.execute({ rawParams, context: mockContext });

        expect(result.content[0].text).toContain('Pending deletion for task "task-1" cancelled');
        expect(mockPlanReader.cancelPendingDeletion).toHaveBeenCalledWith("task-1");
      });

      it("should return error when cancel fails", async () => {
        vi.mocked(mockPlanReader.cancelPendingDeletion).mockResolvedValue({
          success: false,
          error: "No pending deletion found",
        });

        const rawParams: PlanRawParams = { id: "task-1", cancel: true };
        const result = await handler.execute({ rawParams, context: mockContext });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Error: No pending deletion found");
      });
    });

    describe("force cascade deletion", () => {
      it("should return pending deletion message with approval instructions", async () => {
        vi.mocked(mockPlanReader.deleteTask).mockResolvedValue({
          success: true,
          pendingDeletion: ["task-1", "task-2", "task-3"],
        });

        const rawParams: PlanRawParams = { id: "task-1", force: true };
        const result = await handler.execute({ rawParams, context: mockContext });

        const text = result.content[0].text;
        expect(text).toContain("Cascade deletion pending approval");
        expect(text).toContain("3 tasks will be deleted");
        expect(text).toContain("- task-1");
        expect(text).toContain("- task-2");
        expect(text).toContain("- task-3");
        expect(text).toContain('approve(target: "deletion", task_id: "task-1")');
      });
    });

    describe("multiple tasks deleted", () => {
      it("should list all deleted tasks when multiple are deleted", async () => {
        vi.mocked(mockPlanReader.deleteTask).mockResolvedValue({
          success: true,
          deleted: ["task-1", "task-2", "task-3"],
        });

        const rawParams: PlanRawParams = { id: "task-1" };
        const result = await handler.execute({ rawParams, context: mockContext });

        const text = result.content[0].text;
        expect(text).toContain("Deleted 3 tasks");
        expect(text).toContain("- task-1");
        expect(text).toContain("- task-2");
        expect(text).toContain("- task-3");
      });
    });

    it("should return error for invalid params", async () => {
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });
  });
});
