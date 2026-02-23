import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReadOutputHandler } from "../tools/plan/handlers/read-output-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, Task, TaskOutput } from "../types/index.js";

describe("ReadOutputHandler", () => {
  let handler: ReadOutputHandler;
  let mockPlanReader: PlanReader;
  let mockContext: PlanActionContext;

  beforeEach(() => {
    handler = new ReadOutputHandler();

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
    it("should have action 'read_output'", () => {
      expect(handler.action).toBe("read_output");
    });
  });

  describe("help property", () => {
    it("should contain usage instructions", () => {
      expect(handler.help).toContain("# plan read_output");
      expect(handler.help).toContain("plan(action: \"read_output\"");
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

    it("should return 'no output yet' when task has no task_output", async () => {
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
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-1" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("# Task Output: Test Task");
      expect(text).toContain("(no task output yet)");
    });

    it("should return research phase output", async () => {
      const taskOutput: TaskOutput = {
        what: "Investigated the issue",
        why: "Need to understand the problem",
        how: "Code review and testing",
        blockers: [],
        risks: [],
        phase: "research",
        references_used: ["doc-1"],
        references_reason: "Needed context",
        findings: "Found the bug in line 42",
        sources: ["src/main.ts", "tests/unit.test.ts"],
      };
      const mockTask: Task = {
        id: "task-1",
        title: "Research Task",
        content: "",
        status: "completed",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: taskOutput,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-1" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("# Task Output: Research Task");
      expect(text).toContain("**Phase:** research");
      expect(text).toContain("## What");
      expect(text).toContain("Investigated the issue");
      expect(text).toContain("## Why");
      expect(text).toContain("Need to understand the problem");
      expect(text).toContain("## Findings");
      expect(text).toContain("Found the bug in line 42");
      expect(text).toContain("## Sources");
      expect(text).toContain("src/main.ts, tests/unit.test.ts");
    });

    it("should return implement phase output with changes", async () => {
      const taskOutput: TaskOutput = {
        what: "Implemented the fix",
        why: "To resolve the bug",
        how: "Added null check",
        blockers: [],
        risks: ["May affect performance"],
        phase: "implement",
        references_used: [],
        references_reason: "",
        changes: [
          { file: "src/main.ts", lines: "42-45", description: "Added null check" },
          { file: "src/util.ts", lines: "10", description: "Export helper" },
        ],
        design_decisions: "Used early return pattern",
      };
      const mockTask: Task = {
        id: "task-2",
        title: "Implement Task",
        content: "",
        status: "completed",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: taskOutput,
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
      expect(text).toContain("## Changes");
      expect(text).toContain("src/main.ts:42-45 - Added null check");
      expect(text).toContain("src/util.ts:10 - Export helper");
      expect(text).toContain("## Design Decisions");
      expect(text).toContain("Used early return pattern");
      expect(text).toContain("## Risks");
      expect(text).toContain("May affect performance");
    });

    it("should return verify phase output", async () => {
      const taskOutput: TaskOutput = {
        what: "Verified the fix",
        why: "Ensure quality",
        how: "Unit tests and integration tests",
        blockers: ["Waiting for CI"],
        risks: [],
        phase: "verify",
        references_used: [],
        references_reason: "(none)",
        test_target: "validateForm function",
        test_results: "15 tests passed",
        coverage: "95% coverage",
      };
      const mockTask: Task = {
        id: "task-3",
        title: "Verify Task",
        content: "",
        status: "completed",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: taskOutput,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-3" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## Test Target");
      expect(text).toContain("validateForm function");
      expect(text).toContain("## Test Results");
      expect(text).toContain("15 tests passed");
      expect(text).toContain("## Coverage");
      expect(text).toContain("95% coverage");
      expect(text).toContain("## Blockers");
      expect(text).toContain("Waiting for CI");
    });

    it("should return fix phase output with feedback_addressed", async () => {
      const taskOutput: TaskOutput = {
        what: "Fixed the issue",
        why: "Address feedback",
        how: "Refactored code",
        blockers: [],
        risks: [],
        phase: "fix",
        references_used: [],
        references_reason: "",
        changes: [{ file: "src/main.ts", lines: "50-60", description: "Extracted helper" }],
        feedback_addressed: "Extract validation to reusable helper",
      };
      const mockTask: Task = {
        id: "task-4",
        title: "Fix Task",
        content: "",
        status: "completed",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        output: "",
        task_output: taskOutput,
        is_parallelizable: false,
        references: [],
        feedback: [],
        created: "2025-01-01T00:00:00Z",
        updated: "2025-01-01T00:00:00Z",
      };
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams: PlanRawParams = { id: "task-4" };
      const result = await handler.execute(rawParams, mockContext);

      const text = result.content[0].text;
      expect(text).toContain("## Changes");
      expect(text).toContain("src/main.ts:50-60 - Extracted helper");
      expect(text).toContain("## Feedback Addressed");
      expect(text).toContain("Extract validation to reusable helper");
    });

    it("should return error for invalid params", async () => {
      const rawParams = null as unknown as PlanRawParams;
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });
  });
});
