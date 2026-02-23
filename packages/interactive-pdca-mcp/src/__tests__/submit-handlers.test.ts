import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanSubmitHandler } from "../tools/plan/handlers/submit-review/plan-submit-handler.js";
import { DoSubmitHandler } from "../tools/plan/handlers/submit-review/do-submit-handler.js";
import { CheckSubmitHandler } from "../tools/plan/handlers/submit-review/check-submit-handler.js";
import { ActSubmitHandler } from "../tools/plan/handlers/submit-review/act-submit-handler.js";
import { getTaskPhase, TASK_PHASES } from "../tools/plan/handlers/submit-review/base-submit-handler.js";
import type { PlanActionContext, PlanRawParams, PlanReader, PlanReporter, Task } from "../types/index.js";

// Helper to create a base set of valid params for testing
function createBaseParams(phase: string): PlanRawParams {
  return {
    id: `task-1__${phase}`,
    self_review_ref: `_mcp-interactive-instruction__plan__self-review__${phase}`,
    output_what: "Did the thing",
    output_why: "Because it was needed",
    output_how: "By doing it",
    blockers: [],
    risks: [],
    references_used: ["prompts/task-1"],
    references_reason: "Used for context",
  };
}

describe("getTaskPhase", () => {
  it("should return plan phase for __plan suffix", () => {
    expect(getTaskPhase("task-1__plan")).toBe("plan");
  });

  it("should return do phase for __do suffix", () => {
    expect(getTaskPhase("task-1__do")).toBe("do");
  });

  it("should return check phase for __check suffix", () => {
    expect(getTaskPhase("task-1__check")).toBe("check");
  });

  it("should return act phase for __act suffix", () => {
    expect(getTaskPhase("task-1__act")).toBe("act");
  });

  it("should return null for non-phase task", () => {
    expect(getTaskPhase("task-1")).toBeNull();
    expect(getTaskPhase("task-1__other")).toBeNull();
  });

  it("TASK_PHASES should contain all phases", () => {
    expect(TASK_PHASES).toEqual(["plan", "do", "check", "act"]);
  });
});

describe("PlanSubmitHandler", () => {
  let handler: PlanSubmitHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;
  let mockTask: Task;

  beforeEach(() => {
    handler = new PlanSubmitHandler();

    mockTask = {
      id: "task-1__plan",
      title: "Plan Task",
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

  describe("action and phase", () => {
    it("should have correct action and phase", () => {
      expect(handler.action).toBe("submit_plan");
      expect(handler.phase).toBe("plan");
    });
  });

  describe("execute", () => {
    it("should return error for missing base params", async () => {
      const rawParams: PlanRawParams = { id: "task-1__plan" };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
    });

    it("should return error for wrong self_review_ref", async () => {
      const rawParams = {
        ...createBaseParams("plan"),
        self_review_ref: "wrong-ref",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid self_review_ref");
    });

    it("should return error for missing phase-specific fields", async () => {
      const rawParams = createBaseParams("plan");
      // Missing findings and sources
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("findings");
    });

    it("should return error when task not found", async () => {
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(null);

      const rawParams = {
        ...createBaseParams("plan"),
        findings: "Found the issue",
        sources: ["src/main.ts"],
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return error when task is not in_progress", async () => {
      mockTask.status = "pending";
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams = {
        ...createBaseParams("plan"),
        findings: "Found the issue",
        sources: ["src/main.ts"],
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot submit for review");
      expect(result.content[0].text).toContain("pending");
    });

    it("should return error when using wrong handler for task phase", async () => {
      mockTask.id = "task-1__do";
      vi.mocked(mockPlanReader.getTask).mockResolvedValue(mockTask);

      const rawParams = {
        ...createBaseParams("plan"),
        id: "task-1__do",
        findings: "Found the issue",
        sources: ["src/main.ts"],
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Use submit_do instead");
    });

    it("should submit successfully with valid params", async () => {
      const rawParams = {
        ...createBaseParams("plan"),
        findings: "Found the issue in line 42",
        sources: ["src/main.ts:42", "docs/spec.md"],
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("ready for self-review");
      expect(result.content[0].text).toContain("Findings");
      expect(result.content[0].text).toContain("Found the issue in line 42");
      expect(mockPlanReader.updateStatus).toHaveBeenCalled();
      expect(mockPlanReporter.updateAll).toHaveBeenCalled();
    });

    it("should return error when updateStatus fails", async () => {
      vi.mocked(mockPlanReader.updateStatus).mockResolvedValue({
        success: false,
        error: "Failed to update",
      });

      const rawParams = {
        ...createBaseParams("plan"),
        findings: "Found the issue",
        sources: ["src/main.ts"],
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to update");
    });
  });
});

describe("DoSubmitHandler", () => {
  let handler: DoSubmitHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;
  let mockTask: Task;

  beforeEach(() => {
    handler = new DoSubmitHandler();

    mockTask = {
      id: "task-1__do",
      title: "Do Task",
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

  describe("action and phase", () => {
    it("should have correct action and phase", () => {
      expect(handler.action).toBe("submit_do");
      expect(handler.phase).toBe("do");
    });
  });

  describe("execute", () => {
    it("should return error for missing phase-specific fields", async () => {
      const rawParams = createBaseParams("do");
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("changes");
    });

    it("should return error for empty changes array", async () => {
      const rawParams = {
        ...createBaseParams("do"),
        changes: [],
        design_decisions: "Used pattern X",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("changes");
    });

    it("should submit successfully with valid params", async () => {
      const rawParams = {
        ...createBaseParams("do"),
        changes: [
          { file: "src/main.ts", lines: "42-50", description: "Added null check" },
        ],
        design_decisions: "Used early return pattern for clarity",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("ready for self-review");
      expect(result.content[0].text).toContain("Changes");
      expect(result.content[0].text).toContain("Design Decisions");
    });
  });
});

describe("CheckSubmitHandler", () => {
  let handler: CheckSubmitHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;
  let mockTask: Task;

  beforeEach(() => {
    handler = new CheckSubmitHandler();

    mockTask = {
      id: "task-1__check",
      title: "Check Task",
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

  describe("action and phase", () => {
    it("should have correct action and phase", () => {
      expect(handler.action).toBe("submit_check");
      expect(handler.phase).toBe("check");
    });
  });

  describe("execute", () => {
    it("should return error for missing phase-specific fields", async () => {
      const rawParams = createBaseParams("check");
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
    });

    it("should submit successfully with valid params", async () => {
      const rawParams = {
        ...createBaseParams("check"),
        test_target: "validateForm function",
        test_results: "15 tests passed, 0 failed",
        coverage: "95% statement coverage",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("ready for self-review");
      expect(result.content[0].text).toContain("Test Target");
      expect(result.content[0].text).toContain("Test Results");
      expect(result.content[0].text).toContain("Coverage");
    });
  });
});

describe("ActSubmitHandler", () => {
  let handler: ActSubmitHandler;
  let mockPlanReader: PlanReader;
  let mockPlanReporter: PlanReporter;
  let mockContext: PlanActionContext;
  let mockTask: Task;

  beforeEach(() => {
    handler = new ActSubmitHandler();

    mockTask = {
      id: "task-1__act",
      title: "Act Task",
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

  describe("action and phase", () => {
    it("should have correct action and phase", () => {
      expect(handler.action).toBe("submit_act");
      expect(handler.phase).toBe("act");
    });
  });

  describe("execute", () => {
    it("should return error for missing phase-specific fields", async () => {
      const rawParams = createBaseParams("act");
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBe(true);
    });

    it("should submit successfully with valid params", async () => {
      const rawParams = {
        ...createBaseParams("act"),
        changes: [
          { file: "src/main.ts", lines: "50-60", description: "Extracted helper" },
        ],
        feedback_addressed: "Extracted validation to reusable helper function",
      };
      const result = await handler.execute(rawParams, mockContext);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("ready for self-review");
      expect(result.content[0].text).toContain("Changes");
      expect(result.content[0].text).toContain("Feedback Addressed");
    });
  });
});
