import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpdateHandler } from "../tools/plan/handlers/update-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, Task } from "../types/index.js";

describe("UpdateHandler", () => {
  let handler: UpdateHandler;
  let mockPlanReader: PlanReader;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new UpdateHandler();

    mockPlanReader = {
      getTask: vi.fn().mockResolvedValue(null),
      updateTask: vi.fn().mockResolvedValue({ success: true }),
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
    it("should have action 'update'", () => {
      expect(handler.action).toBe("update");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan update");
      expect(handler.help).toContain("plan(action: \"update\"");
    });
  });

  describe("execute", () => {
    it("should return error for missing id", async () => {
      const rawParams: PlanRawParams = { title: "New Title" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });

    it("should return error when no update fields provided", async () => {
      const rawParams: PlanRawParams = { id: "task-1" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("At least one field to update is required");
    });

    it("should update task title successfully", async () => {
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = { id: "task-1", title: "New Title" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain('Task "task-1" updated successfully');
      expect(mockPlanReader.updateTask).toHaveBeenCalledWith({
        id: "task-1",
        title: "New Title",
        content: undefined,
        dependencies: undefined,
        dependency_reason: undefined,
        prerequisites: undefined,
        completion_criteria: undefined,
        is_parallelizable: undefined,
        parallelizable_units: undefined,
        references: undefined,
      });
    });

    it("should update task content successfully", async () => {
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = { id: "task-1", content: "Updated content" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain('Task "task-1" updated successfully');
    });

    it("should require dependency_reason when adding dependencies to task without reason", async () => {
      const mockTask: Task = {
        id: "task-1",
        title: "Task",
        content: "",
        status: "pending",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: null,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "",
        updated: "",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-1", dependencies: ["dep-1"] };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("dependency_reason is required");
    });

    it("should allow dependencies update when task already has dependency_reason", async () => {
      const mockTask: Task = {
        id: "task-1",
        title: "Task",
        content: "",
        status: "pending",
        parent: "",
        dependencies: ["existing-dep"],
        dependency_reason: "Existing reason",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: null,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "",
        updated: "",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = { id: "task-1", dependencies: ["dep-1", "dep-2"] };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain("updated successfully");
    });

    it("should allow dependencies with dependency_reason provided", async () => {
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = {
        id: "task-1",
        dependencies: ["dep-1"],
        dependency_reason: "Need this completed first",
      };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain("updated successfully");
    });

    it("should update parallelizable settings", async () => {
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = {
        id: "task-1",
        is_parallelizable: true,
        parallelizable_units: ["unit-a", "unit-b"],
      };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain("updated successfully");
      expect(mockPlanReader.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          is_parallelizable: true,
          parallelizable_units: ["unit-a", "unit-b"],
        })
      );
    });

    it("should return error when updateTask fails", async () => {
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({
        success: false,
        error: "Task not found",
      });

      const rawParams: PlanRawParams = { id: "task-1", title: "New Title" };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error: Task not found");
    });

    it("should update multiple fields at once", async () => {
      vi.mocked(mockPlanReader.updateTask).mockResolvedValue({ success: true });

      const rawParams: PlanRawParams = {
        id: "task-1",
        title: "Updated Title",
        content: "Updated content",
        prerequisites: "Updated prereqs",
        completion_criteria: "Updated criteria",
        references: ["doc-1", "doc-2"],
      };
      const result = await handler.execute({ rawParams, context: mockContext });

      expect(result.content[0].text).toContain("updated successfully");
      expect(mockPlanReader.updateTask).toHaveBeenCalledWith({
        id: "task-1",
        title: "Updated Title",
        content: "Updated content",
        dependencies: undefined,
        dependency_reason: undefined,
        prerequisites: "Updated prereqs",
        completion_criteria: "Updated criteria",
        is_parallelizable: undefined,
        parallelizable_units: undefined,
        references: ["doc-1", "doc-2"],
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
