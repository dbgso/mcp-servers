import { describe, it, expect, vi, beforeEach } from "vitest";
import { BlockHandler } from "../tools/plan/handlers/block-handler.js";
import { RequestChangesHandler } from "../tools/plan/handlers/request-changes-handler.js";
import { InterpretHandler } from "../tools/plan/handlers/interpret-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, PlanReporter, FeedbackReader, Task } from "../types/index.js";

describe("BlockHandler", () => {
  let handler: BlockHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;
  let mockTask: Task;

  beforeEach(() => {
    handler = new BlockHandler();

    mockTask = {
      id: "task-1",
      title: "Test Task",
      content: "",
      status: "in_progress",
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

    mockPlanReader = {
      getTask: vi.fn().mockResolvedValue(mockTask),
      updateStatus: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as PlanReader;

    mockPlanReporter = {
      updateAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlanReporter;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: mockPlanReporter,
      feedbackReader: {} as PlanActionContext["feedbackReader"],
      planDir: "/tmp/plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("action property", () => {
    it("should have action 'block'", () => {
      expect(handler.action).toBe("block");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan block");
      expect(handler.help).toContain("reason");
    });
  });

  describe("execute", () => {
    it("should return error for missing params", async () => {
      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });

    it("should return error when task not found", async () => {
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(null);

      const rawParams: PlanRawParams = { id: "task-1", reason: "Blocked due to X" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return error when blocking completed task", async () => {
      mockTask.status = "completed";
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-1", reason: "Blocked due to X" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot block a completed task");
    });

    it("should return error when blocking skipped task", async () => {
      mockTask.status = "skipped";
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-1", reason: "Blocked due to X" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot block a skipped task");
    });

    it("should block task successfully", async () => {
      const rawParams: PlanRawParams = { id: "task-1", reason: "Waiting for API access" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("marked as blocked");
      expect(result.content[0].text).toContain("in_progress → blocked");
      expect(result.content[0].text).toContain("Waiting for API access");
      expect(mockPlanReader.updateStatus).toHaveBeenCalledWith({
        id: "task-1",
        status: "blocked",
        output: "Waiting for API access",
      });
    });

    it("should return error when updateStatus fails", async () => {
      vi.mocked(mockPlanReader.updateStatus).mockResolvedValue({
        success: false,
        error: "Failed to update",
      });

      const rawParams: PlanRawParams = { id: "task-1", reason: "Blocked" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to update");
    });
  });
});

describe("RequestChangesHandler", () => {
  let handler: RequestChangesHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockFeedbackReader: FeedbackReader;
  let mockContext: PlanActionContext;
  let mockTask: Task;

  beforeEach(() => {
    handler = new RequestChangesHandler();

    mockTask = {
      id: "task-1",
      title: "Test Task",
      content: "",
      status: "pending_review",
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

    mockPlanReader = {
      getTask: vi.fn().mockResolvedValue(mockTask),
      updateStatus: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as PlanReader;

    mockPlanReporter = {
      updateAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlanReporter;

    mockFeedbackReader = {
      createDraftFeedback: vi.fn().mockResolvedValue({ success: true, feedbackId: "fb-001" }),
    } as unknown as FeedbackReader;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: mockPlanReporter,
      feedbackReader: mockFeedbackReader,
      planDir: "/tmp/plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("action property", () => {
    it("should have action 'request_changes'", () => {
      expect(handler.action).toBe("request_changes");
    });
  });

  describe("execute", () => {
    it("should return error for missing params", async () => {
      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
    });

    it("should return error when task not found", async () => {
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(null);

      const rawParams: PlanRawParams = {
        id: "task-1",
        comment: "Please fix X",
        decision: "adopted",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return error when task is not pending_review", async () => {
      mockTask.status = "in_progress";
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = {
        id: "task-1",
        comment: "Please fix X",
        decision: "adopted",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Only pending_review tasks");
    });

    it("should create feedback and transition task", async () => {
      const rawParams: PlanRawParams = {
        id: "task-1",
        comment: "Please add error handling",
        decision: "adopted",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Changes requested");
      expect(result.content[0].text).toContain("pending_review → in_progress");
      expect(mockFeedbackReader.createDraftFeedback).toHaveBeenCalled();
      expect(mockPlanReader.updateStatus).toHaveBeenCalledWith({
        id: "task-1",
        status: "in_progress",
      });
    });

    it("should return error when feedback creation fails", async () => {
      vi.mocked(mockFeedbackReader.createDraftFeedback).mockResolvedValue({
        success: false,
        error: "Failed to create feedback",
      });

      const rawParams: PlanRawParams = {
        id: "task-1",
        comment: "Please fix",
        decision: "adopted",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to create feedback");
    });

    it("should return error when updateStatus fails", async () => {
      vi.mocked(mockPlanReader.updateStatus).mockResolvedValue({
        success: false,
        error: "Failed to update status",
      });

      const rawParams: PlanRawParams = {
        id: "task-1",
        comment: "Please fix",
        decision: "adopted",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to update status");
    });
  });
});

describe("InterpretHandler", () => {
  let handler: InterpretHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockFeedbackReader: FeedbackReader;
  let mockContext: PlanActionContext;
  let mockTask: Task;
  let mockFeedback: { id: string; task_id: string; original: string; interpretation: string | null; decision: string; status: string; timestamp: string; addressed_by: string | null };

  beforeEach(() => {
    handler = new InterpretHandler();

    mockTask = {
      id: "task-1",
      title: "Test Task",
      content: "",
      status: "in_progress",
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

    mockFeedback = {
      id: "fb-001",
      task_id: "task-1",
      original: "Please fix the bug",
      interpretation: null,
      decision: "adopted",
      status: "draft",
      timestamp: "2025-01-01T00:00:00Z",
      addressed_by: null,
    };

    mockPlanReader = {
      getTask: vi.fn().mockResolvedValue(mockTask),
    } as unknown as PlanReader;

    mockPlanReporter = {
      updateAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as PlanReporter;

    mockFeedbackReader = {
      getFeedback: vi.fn().mockResolvedValue(mockFeedback),
      addInterpretation: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as FeedbackReader;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: mockPlanReporter,
      feedbackReader: mockFeedbackReader,
      planDir: "/tmp/plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("action property", () => {
    it("should have action 'interpret'", () => {
      expect(handler.action).toBe("interpret");
    });
  });

  describe("execute", () => {
    it("should return error for missing params", async () => {
      const rawParams: PlanRawParams = {};
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
    });

    it("should return error when feedback not found", async () => {
      vi.mocked(mockFeedbackReader.getFeedback).mockResolvedValue(null);

      const rawParams: PlanRawParams = {
        id: "task-1",
        feedback_id: "fb-001",
        interpretation: "Will add null check",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return error when feedback is already confirmed", async () => {
      mockFeedback.status = "confirmed";
      vi.mocked(mockFeedbackReader.getFeedback).mockResolvedValue(mockFeedback);

      const rawParams: PlanRawParams = {
        id: "task-1",
        feedback_id: "fb-001",
        interpretation: "Will add null check",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("already confirmed");
    });

    it("should add interpretation successfully", async () => {
      const rawParams: PlanRawParams = {
        id: "task-1",
        feedback_id: "fb-001",
        interpretation: "Will add null check to prevent crash",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Interpretation added");
      expect(result.content[0].text).toContain("Please fix the bug");
      expect(mockFeedbackReader.addInterpretation).toHaveBeenCalledWith({
        taskId: "task-1",
        feedbackId: "fb-001",
        interpretation: "Will add null check to prevent crash",
      });
      expect(mockPlanReporter.updateAll).toHaveBeenCalled();
    });

    it("should return error when addInterpretation fails", async () => {
      vi.mocked(mockFeedbackReader.addInterpretation).mockResolvedValue({
        success: false,
        error: "Feedback not found",
      });

      const rawParams: PlanRawParams = {
        id: "task-1",
        feedback_id: "fb-001",
        interpretation: "Will fix it",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Feedback not found");
    });
  });
});
