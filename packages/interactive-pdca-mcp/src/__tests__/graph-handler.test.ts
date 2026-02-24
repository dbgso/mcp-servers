import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphHandler } from "../tools/plan/handlers/graph-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, TaskSummary } from "../types/index.js";

describe("GraphHandler", () => {
  let handler: GraphHandler;
  let mockPlanReader: PlanReader;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new GraphHandler();

    mockPlanReader = {
      listTasks: vi.fn().mockResolvedValue([]),
      getBlockedTasks: vi.fn().mockResolvedValue([]),
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
    it("should have action 'graph'", () => {
      expect(handler.action).toBe("graph");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan graph");
      expect(handler.help).toContain("plan(action: \"graph\")");
    });
  });

  describe("execute", () => {
    it("should return 'no tasks' message when list is empty", async () => {
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "No tasks to graph.",
      });
    });

    it("should generate mermaid flowchart for tasks", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "task-1", title: "Task One", status: "pending", dependencies: [], is_parallelizable: false, parent: "" },
        { id: "task-2", title: "Task Two", status: "pending", dependencies: ["task-1"], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("# Task Graph");
      expect(text).toContain("```mermaid");
      expect(text).toContain("flowchart TD");
      expect(text).toContain("task_1[Task One");
      expect(text).toContain("task_2[Task Two");
      expect(text).toContain("task_1 --> task_2");
      expect(text).toContain("## Legend");
    });

    it("should use rounded brackets for parallelizable tasks", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "parallel-task", title: "Parallel Task", status: "pending", dependencies: [], is_parallelizable: true, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("parallel_task([Parallel Task");
    });

    it("should show correct icon for completed status", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "done-task", title: "Done Task", status: "completed", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("Done Task ✓");
    });

    it("should show correct icon for in_progress status", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "wip-task", title: "WIP Task", status: "in_progress", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("WIP Task ●");
    });

    it("should show correct icon for pending_review status", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "review-task", title: "Review Task", status: "pending_review", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("Review Task ⏳");
    });

    it("should show blocked icon for blocked tasks", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "blocked-task", title: "Blocked Task", status: "blocked", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue(mockTasks);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("Blocked Task ◇");
    });

    it("should show skipped icon for skipped status", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "skip-task", title: "Skipped Task", status: "skipped", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("Skipped Task ⊘");
    });

    it("should apply correct styling for different statuses", async () => {
      const mockTasks: TaskSummary[] = [
        { id: "completed-task", title: "Completed", status: "completed", dependencies: [], is_parallelizable: false, parent: "" },
        { id: "progress-task", title: "In Progress", status: "in_progress", dependencies: [], is_parallelizable: false, parent: "" },
        { id: "review-task", title: "Review", status: "pending_review", dependencies: [], is_parallelizable: false, parent: "" },
        { id: "skipped-task", title: "Skipped", status: "skipped", dependencies: [], is_parallelizable: false, parent: "" },
      ];
      vi.mocked(mockPlanReader.listTasks).mockResolvedValue(mockTasks);
      vi.mocked(mockPlanReader.getBlockedTasks).mockResolvedValue([]);

      const rawParams: PlanRawParams = {};
      const result = await handler.execute({ rawParams, context: mockContext });

      const text = result.content[0].text;
      expect(text).toContain("style completed_task fill:#90EE90,stroke:#228B22");
      expect(text).toContain("style progress_task fill:#87CEEB,stroke:#4169E1");
      expect(text).toContain("style review_task fill:#DDA0DD,stroke:#8B008B");
      expect(text).toContain("style skipped_task fill:#D3D3D3,stroke:#808080");
    });

    it("should return error for invalid params", async () => {
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });
  });
});
