import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeedbackHandler } from "../tools/plan/handlers/feedback-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, Task, FeedbackEntry, FeedbackReader } from "../types/index.js";

describe("FeedbackHandler (plan)", () => {
  let handler: FeedbackHandler;
  let mockPlanReader: PlanReader;
  let mockFeedbackReader: FeedbackReader;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new FeedbackHandler();

    mockPlanReader = {
      getTask: vi.fn().mockResolvedValue(null),
    } as unknown as PlanReader;

    mockFeedbackReader = {
      listFeedback: vi.fn().mockResolvedValue([]),
      getFeedback: vi.fn().mockResolvedValue(null),
    } as unknown as FeedbackReader;

    mockContext = {
      planReader: mockPlanReader,
      planReporter: {} as PlanActionContext["planReporter"],
      feedbackReader: mockFeedbackReader,
      planDir: "/tmp/mcp-interactive-instruction-plan",
      config: {} as PlanActionContext["config"],
    };
  });

  describe("action property", () => {
    it("should have action 'feedback'", () => {
      expect(handler.action).toBe("feedback");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan feedback");
      expect(handler.help).toContain("plan(action: \"feedback\"");
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

    describe("list feedback", () => {
      it("should return 'no feedback' message when empty", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        vi.mocked(mockFeedbackReader.listFeedback).mockResolvedValue([]);

        const rawParams: PlanRawParams = { id: "task-1" };
        const result = await handler.execute(rawParams, mockContext);

        expect(result.content[0].text).toContain('No feedback found for task "task-1"');
      });

      it("should list all feedback categorized by status", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        const feedbackList: FeedbackEntry[] = [
          {
            id: "fb-001",
            task_id: "task-1",
            original: "Please fix this",
            interpretation: null,
            decision: "adopted",
            status: "draft",
            timestamp: "2025-01-01T10:00:00Z",
            addressed_by: null,
          },
          {
            id: "fb-002",
            task_id: "task-1",
            original: "Good work",
            interpretation: "AI interprets this as approval",
            decision: "adopted",
            status: "confirmed",
            timestamp: "2025-01-01T11:00:00Z",
            addressed_by: null,
          },
          {
            id: "fb-003",
            task_id: "task-1",
            original: "Done feedback",
            interpretation: "Addressed",
            decision: "adopted",
            status: "confirmed",
            timestamp: "2025-01-01T12:00:00Z",
            addressed_by: "commit-abc",
          },
        ];
        vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
        vi.mocked(mockFeedbackReader.listFeedback).mockResolvedValue(feedbackList);

        const rawParams: PlanRawParams = { id: "task-1" };
        const result = await handler.execute(rawParams, mockContext);

        const text = result.content[0].text;
        expect(text).toContain("# Feedback for: Test Task");
        expect(text).toContain("**Total:** 3");
        expect(text).toContain("Draft: 1");
        expect(text).toContain("Confirmed: 2");
        expect(text).toContain("Addressed: 1");
        expect(text).toContain("## 📝 Draft (needs interpretation)");
        expect(text).toContain("fb-001");
        expect(text).toContain("## ⚠️ Unaddressed (confirmed, needs work)");
        expect(text).toContain("fb-002");
        expect(text).toContain("## ✅ Addressed");
        expect(text).toContain("fb-003");
      });

      it("should truncate long original feedback", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        const longOriginal = "A".repeat(100);
        const feedbackList: FeedbackEntry[] = [
          {
            id: "fb-001",
            task_id: "task-1",
            original: longOriginal,
            interpretation: null,
            decision: "adopted",
            status: "draft",
            timestamp: "2025-01-01T10:00:00Z",
            addressed_by: null,
          },
        ];
        vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
        vi.mocked(mockFeedbackReader.listFeedback).mockResolvedValue(feedbackList);

        const rawParams: PlanRawParams = { id: "task-1" };
        const result = await handler.execute(rawParams, mockContext);

        const text = result.content[0].text;
        expect(text).toContain("A".repeat(80) + "...");
      });
    });

    describe("show specific feedback", () => {
      it("should return error when feedback not found", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        vi.mocked(mockFeedbackReader.getFeedback).mockResolvedValue(null);

        const rawParams: PlanRawParams = { id: "task-1", feedback_id: "fb-999" };
        const result = await handler.execute(rawParams, mockContext);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Feedback "fb-999" not found');
      });

      it("should show draft feedback details", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        const feedback: FeedbackEntry = {
          id: "fb-001",
          task_id: "task-1",
          original: "Please fix the bug",
          interpretation: null,
          decision: "adopted",
          status: "draft",
          timestamp: "2025-01-01T10:00:00Z",
          addressed_by: null,
        };
        vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
        vi.mocked(mockFeedbackReader.getFeedback).mockResolvedValue(feedback);

        const rawParams: PlanRawParams = { id: "task-1", feedback_id: "fb-001" };
        const result = await handler.execute(rawParams, mockContext);

        const text = result.content[0].text;
        expect(text).toContain("# Feedback: fb-001");
        expect(text).toContain("📝 DRAFT");
        expect(text).toContain("**Task:** task-1");
        expect(text).toContain("**Decision:** adopted");
        expect(text).toContain("Please fix the bug");
        expect(text).toContain("No interpretation yet");
        expect(text).toContain('plan(action: "interpret"');
      });

      it("should show draft feedback with interpretation ready for approval", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        const feedback: FeedbackEntry = {
          id: "fb-001",
          task_id: "task-1",
          original: "Please fix the bug",
          interpretation: "AI will add null check to function",
          decision: "adopted",
          status: "draft",
          timestamp: "2025-01-01T10:00:00Z",
          addressed_by: null,
        };
        vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
        vi.mocked(mockFeedbackReader.getFeedback).mockResolvedValue(feedback);

        const rawParams: PlanRawParams = { id: "task-1", feedback_id: "fb-001" };
        const result = await handler.execute(rawParams, mockContext);

        const text = result.content[0].text;
        expect(text).toContain("## AI Interpretation");
        expect(text).toContain("AI will add null check to function");
        expect(text).toContain("Ready for approval:");
        expect(text).toContain('approve(target: "feedback"');
      });

      it("should show confirmed feedback details", async () => {
        const mockTask: Task = {
          id: "task-1",
          title: "Test Task",
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
        const feedback: FeedbackEntry = {
          id: "fb-001",
          task_id: "task-1",
          original: "Fixed the bug",
          interpretation: "Addressed in commit",
          decision: "adopted",
          status: "confirmed",
          timestamp: "2025-01-01T10:00:00Z",
          addressed_by: "commit-123",
        };
        vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);
        vi.mocked(mockFeedbackReader.getFeedback).mockResolvedValue(feedback);

        const rawParams: PlanRawParams = { id: "task-1", feedback_id: "fb-001" };
        const result = await handler.execute(rawParams, mockContext);

        const text = result.content[0].text;
        expect(text).toContain("✅ CONFIRMED");
        expect(text).toContain("**Addressed by:** commit-123");
      });
    });

    it("should return error for invalid params", async () => {
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });
  });
});
