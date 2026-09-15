/**
 * The guards and the sparse-output paths across the plan handlers.
 *
 * Two groups, both about incomplete input. The guards decide whether work can
 * start or be confirmed at all -- a subtask with no content, a task that is not
 * there, a self-review reference that names the wrong phase -- and each of them
 * is the last thing between a caller and a task marked done on no evidence.
 * The output sections are the other half: a phase report missing a field has to
 * say "(none)" rather than print `undefined` into a document someone reads.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StartHandler } from "../tools/plan/handlers/start-handler.js";
import { ConfirmHandler } from "../tools/plan/handlers/confirm-handler.js";
import { AddHandler } from "../tools/plan/handlers/add-handler.js";
import { ReadOutputHandler } from "../tools/plan/handlers/read-output-handler.js";
import type {
  PlanActionContext,
  PlanReader,
  PlanReporter,
  Task,
  TaskOutput,
} from "../types/index.js";

const baseTask: Task = {
  id: "task-1",
  title: "Test Task",
  content: "do the thing",
  status: "pending",
  parent: "",
  dependencies: [],
  dependency_reason: "",
  prerequisites: "",
  completion_criteria: "it is done",
  deliverables: [],
  output: "",
  task_output: null,
  is_parallelizable: false,
  references: [],
  feedback: [],
  created: "",
  updated: "",
};

const baseOutput: TaskOutput = {
  what: "what",
  why: "why",
  how: "how",
  blockers: [],
  risks: [],
  phase: "research",
  references_used: [],
  references_reason: "",
};

let context: PlanActionContext;
let planReader: PlanReader;

function readerFor(overrides: Record<string, unknown> = {}): PlanReader {
  return {
    getTask: vi.fn().mockResolvedValue(baseTask),
    addTask: vi.fn().mockResolvedValue({ success: true }),
    updateStatus: vi.fn().mockResolvedValue({ success: true }),
    getReadyTasks: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
    getChildTasks: vi.fn().mockResolvedValue([]),
    taskExists: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as PlanReader;
}

const text = (r: { content: { type: string; text: string }[] }) =>
  r.content.map((c) => c.text).join("\n");

beforeEach(() => {
  planReader = readerFor();
  context = {
    planReader,
    planReporter: { updateAll: vi.fn().mockResolvedValue(undefined) } as unknown as PlanReporter,
    feedbackReader: {
      getFeedbackByTask: vi.fn().mockResolvedValue(new Map()),
      getDraftFeedback: vi.fn().mockResolvedValue([]),
    } as unknown as PlanActionContext["feedbackReader"],
    planDir: "/tmp/mcp-pdca-guard-edges",
    markdownDir: "/tmp/mcp-pdca-docs",
    config: {
      remindMcp: false,
      remindOrganize: false,
      customReminders: [],
      topicForEveryTask: null,
      infoValidSeconds: 60,
    },
  } as unknown as PlanActionContext;
});

describe("starting a task", () => {
  it("says so when the task is not there", async () => {
    context.planReader = readerFor({ getTask: vi.fn().mockResolvedValue(null) });

    const result = await new StartHandler().execute({
      rawParams: { id: "absent", prompt: "go" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });

  it.each([
    { missing: "content", task: { content: "   " } },
    { missing: "completion_criteria", task: { completion_criteria: "" } },
  ])("refuses a subtask with no $missing", async ({ missing, task }) => {
    // A PDCA phase with no statement of what it is or when it is done cannot
    // be reviewed afterwards, so it is refused before it starts rather than
    // at the confirm.
    context.planReader = readerFor({
      getTask: vi.fn().mockResolvedValue({ ...baseTask, parent: "parent-1", ...task }),
    });

    const result = await new StartHandler().execute({
      rawParams: { id: "parent-1__do", prompt: "go" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(missing);
  });

  it("names both missing fields at once", async () => {
    context.planReader = readerFor({
      getTask: vi.fn().mockResolvedValue({
        ...baseTask,
        parent: "parent-1",
        content: "",
        completion_criteria: "",
      }),
    });

    const result = await new StartHandler().execute({
      rawParams: { id: "parent-1__do", prompt: "go" },
      context,
    });

    expect(text(result)).toContain("content, completion_criteria");
  });

  it("carries on when a PDCA subtask already exists", async () => {
    // Re-starting a task that was started before finds its phases already
    // there. That is not a failure -- the phases are what the caller wanted.
    context.planReader = readerFor({
      addTask: vi.fn().mockResolvedValue({ success: false, error: "already exists" }),
    });

    const result = await new StartHandler().execute({
      rawParams: { id: "task-1", prompt: "go" },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(context.planReader.updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      status: "in_progress",
    });
  });

  it("reports a status write that fails", async () => {
    context.planReader = readerFor({
      updateStatus: vi.fn().mockResolvedValue({ success: false, error: "read-only volume" }),
    });

    const result = await new StartHandler().execute({
      rawParams: { id: "task-1", prompt: "go" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("read-only volume");
  });
});

describe("confirming a task", () => {
  it("says so when the task is not there", async () => {
    context.planReader = readerFor({ getTask: vi.fn().mockResolvedValue(null) });

    const result = await new ConfirmHandler().execute({
      rawParams: {
        id: "absent",
        self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
        review_summary:
          "Checked every completion criterion against the output, and the evidence below.",
        evidence: ["file.ts:1-10"],
      },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });

  it("refuses a self-review reference for a different phase", async () => {
    // The reference names the checklist the reviewer says they followed. A
    // mismatch means they followed a different one, or none.
    context.planReader = readerFor({
      getTask: vi.fn().mockResolvedValue({
        ...baseTask,
        id: "task-1__do",
        status: "in_progress",
      }),
    });

    const result = await new ConfirmHandler().execute({
      rawParams: {
        id: "task-1__do",
        self_review_ref: "_mcp-interactive-instruction__plan__self-review__check",
        review_summary:
          "Checked every completion criterion against the output, and the evidence below.",
        evidence: ["file.ts:1-10"],
      },
      context,
    });

    expect(result.isError).toBe(true);
  });
});

describe("adding a task", () => {
  it("refuses dependencies with no reason for them", async () => {
    // A dependency nobody explained is the one that gets dropped later,
    // because no reader can tell whether it still holds.
    const result = await new AddHandler().execute({
      rawParams: {
        id: "task-2",
        title: "Second",
        content: "c",
        prerequisites: "",
        completion_criteria: "done",
        deliverables: [],
        is_parallelizable: false,
        references: [],
        dependencies: ["task-1"],
      },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/dependency_reason/);
  });

  it("names the parent in the response when there is one", async () => {
    const result = await new AddHandler().execute({
      rawParams: {
        id: "task-2",
        title: "Second",
        content: "c",
        prerequisites: "",
        completion_criteria: "done",
        deliverables: [],
        is_parallelizable: false,
        references: [],
        dependencies: [],
        parent: "task-1",
      },
      context,
    });

    expect(text(result)).toContain("task-1");
  });
});

describe("reading a task's output", () => {
  function taskWith(output: Partial<TaskOutput>): PlanReader {
    return readerFor({
      getTask: vi.fn().mockResolvedValue({
        ...baseTask,
        status: "completed",
        task_output: { ...baseOutput, ...output },
      }),
    });
  }

  it("says (none) for a research report with no findings or sources", async () => {
    context.planReader = taskWith({ phase: "research" });

    const result = await new ReadOutputHandler().execute({
      rawParams: { id: "task-1" },
      context,
    });

    expect(text(result)).toContain("## Findings\n(none)");
    expect(text(result)).toContain("## Sources\n(none)");
  });

  it("lists the sources a research report does carry", async () => {
    context.planReader = taskWith({
      phase: "research",
      findings: "it works",
      sources: ["docs/a.md", "docs/b.md"],
    });

    const result = await new ReadOutputHandler().execute({
      rawParams: { id: "task-1" },
      context,
    });

    expect(text(result)).toContain("docs/a.md, docs/b.md");
  });

  it("says (none) for a verify report with none of its fields", async () => {
    context.planReader = taskWith({ phase: "verify" });

    const result = await new ReadOutputHandler().execute({
      rawParams: { id: "task-1" },
      context,
    });

    expect(text(result)).toContain("## Test Target\n(none)");
    expect(text(result)).toContain("## Test Results\n(none)");
    expect(text(result)).toContain("## Coverage\n(none)");
  });

  it("reports a verify run that has them", async () => {
    context.planReader = taskWith({
      phase: "verify",
      test_target: "the parser",
      test_results: "12 passed",
      coverage: "97%",
    });

    const result = await new ReadOutputHandler().execute({
      rawParams: { id: "task-1" },
      context,
    });

    expect(text(result)).toContain("12 passed");
    expect(text(result)).toContain("97%");
  });

  it("leaves the changes section out when an implement report has none", async () => {
    context.planReader = taskWith({ phase: "implement", changes: [] });

    const result = await new ReadOutputHandler().execute({
      rawParams: { id: "task-1" },
      context,
    });

    expect(text(result)).not.toContain("## Changes");
  });
});
