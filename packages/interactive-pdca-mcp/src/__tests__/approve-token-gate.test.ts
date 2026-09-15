/**
 * `approve(target: "task")` and `approve(target: "skip")`, including the
 * approval gate that every existing test bypasses.
 *
 * Both handlers disable their gate when `VITEST` or `NODE_ENV=test` is set, so
 * the notification request, the token check and the refusal on a bad token had
 * never run -- the two code paths that decide whether a task can be approved
 * at all. These tests clear those variables for the duration, which is the
 * only way to reach them.
 *
 * Worth knowing while reading: the gate is the desktop-notification token
 * scheme that interactive-instruction-mcp has since dropped, and the bypass is
 * keyed on environment variables, so a server started with `NODE_ENV=test`
 * approves without asking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskHandler } from "../tools/approve/handlers/task-handler.js";
import { SkipHandler } from "../tools/approve/handlers/skip-handler.js";
import type {
  ApproveActionContext,
  ApproveActionParams,
  PlanReader,
  PlanReporter,
  Task,
} from "../types/index.js";

const task: Task = {
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

let context: ApproveActionContext;
let planReader: PlanReader;
let updateAll: ReturnType<typeof vi.fn>;

/** A reader whose task lookups and writes all succeed. */
function readerFor(overrides: Partial<Record<string, unknown>> = {}): PlanReader {
  return {
    getTask: vi.fn().mockResolvedValue(task),
    approveTask: vi.fn().mockResolvedValue({ success: true }),
    updateStatus: vi.fn().mockResolvedValue({ success: true }),
    getReadyTasks: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PlanReader;
}

const text = (r: { content: { type: string; text: string }[] }) =>
  r.content.map((c) => c.text).join("\n");

beforeEach(() => {
  updateAll = vi.fn().mockResolvedValue(undefined);
  planReader = readerFor();
  context = {
    markdownDir: "/tmp/markdown",
    planReader,
    planReporter: { updateAll } as unknown as PlanReporter,
    feedbackReader: {} as ApproveActionContext["feedbackReader"],
  };
});

describe("without the gate (the environment every test runs in)", () => {
  it.each([
    {
      name: "approves a task",
      handler: () => new TaskHandler(),
      params: { target: "task", task_id: "task-1" } as ApproveActionParams,
      expected: /approved|Approved/,
    },
    {
      name: "skips a task with a reason",
      handler: () => new SkipHandler(),
      params: {
        target: "skip",
        task_id: "task-1",
        reason: "superseded by task-2",
      } as ApproveActionParams,
      expected: /skipped/,
    },
  ])("$name straight through", async ({ handler, params, expected }) => {
    const result = await handler().execute({ actionParams: params, context });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(expected);
    expect(updateAll).toHaveBeenCalled();
  });
});

describe("with the gate live", () => {
  const saved = { vitest: process.env.VITEST, nodeEnv: process.env.NODE_ENV };

  beforeEach(() => {
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    if (saved.vitest !== undefined) process.env.VITEST = saved.vitest;
    if (saved.nodeEnv !== undefined) process.env.NODE_ENV = saved.nodeEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Swap the approval module so no notification is sent and no token is real. */
  async function withApproval(params: { valid: boolean; reason?: string }) {
    const requestApproval = vi.fn(async () => ({ fallbackPath: "/tmp/token.txt" }));
    const validateApproval = vi.fn(() => ({
      valid: params.valid,
      ...(params.reason !== undefined && { reason: params.reason }),
    }));
    vi.resetModules();
    vi.doMock("mcp-shared/approval", () => ({ requestApproval, validateApproval }));
    const [{ TaskHandler: T }, { SkipHandler: S }] = await Promise.all([
      import("../tools/approve/handlers/task-handler.js"),
      import("../tools/approve/handlers/skip-handler.js"),
    ]);
    return { TaskHandler: T, SkipHandler: S, requestApproval, validateApproval };
  }

  it("asks for approval before approving a task, and does not approve yet", async () => {
    const { TaskHandler: T, requestApproval } = await withApproval({ valid: true });

    const result = await new T().execute({
      actionParams: { target: "task", task_id: "task-1" },
      context,
    });

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(text(result)).toContain("Approval Requested");
    expect(text(result)).toContain("/tmp/token.txt");
    expect(planReader.approveTask).not.toHaveBeenCalled();
  });

  it("approves once a valid token comes back", async () => {
    const { TaskHandler: T, validateApproval } = await withApproval({ valid: true });

    const result = await new T().execute({
      actionParams: { target: "task", task_id: "task-1", approvalToken: "123456" },
      context,
    });

    expect(validateApproval).toHaveBeenCalledWith({
      requestId: "pdca-approve-task-1",
      providedToken: "123456",
    });
    expect(result.isError).toBeFalsy();
    expect(planReader.approveTask).toHaveBeenCalledWith("task-1");
  });

  it("refuses a token that does not match, and does not approve", async () => {
    const { TaskHandler: T } = await withApproval({ valid: false, reason: "expired" });

    const result = await new T().execute({
      actionParams: { target: "task", task_id: "task-1", approvalToken: "000000" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("expired");
    expect(planReader.approveTask).not.toHaveBeenCalled();
  });

  it("asks for approval before skipping a task", async () => {
    const { SkipHandler: S, requestApproval } = await withApproval({ valid: true });

    const result = await new S().execute({
      actionParams: { target: "skip", task_id: "task-1", reason: "no longer needed" },
      context,
    });

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(text(result)).toContain("Approval Requested");
    expect(planReader.updateStatus).not.toHaveBeenCalled();
  });

  it("skips once a valid token comes back", async () => {
    const { SkipHandler: S } = await withApproval({ valid: true });

    const result = await new S().execute({
      actionParams: {
        target: "skip",
        task_id: "task-1",
        reason: "no longer needed",
        approvalToken: "123456",
      },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(planReader.updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      status: "skipped",
      output: "no longer needed",
    });
  });

  it("refuses a bad token on a skip too", async () => {
    const { SkipHandler: S } = await withApproval({ valid: false, reason: "unknown request" });

    const result = await new S().execute({
      actionParams: {
        target: "skip",
        task_id: "task-1",
        reason: "no longer needed",
        approvalToken: "000000",
      },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("unknown request");
    expect(planReader.updateStatus).not.toHaveBeenCalled();
  });
});

describe("what both handlers refuse outright", () => {
  it.each([
    {
      name: "a task approval with no id",
      handler: () => new TaskHandler(),
      params: { target: "task" } as ApproveActionParams,
      expected: /task_id is required/,
    },
    {
      name: "a skip with no id",
      handler: () => new SkipHandler(),
      params: { target: "skip" } as ApproveActionParams,
      expected: /task_id is required/,
    },
    {
      name: "a skip with no reason",
      handler: () => new SkipHandler(),
      params: { target: "skip", task_id: "task-1" } as ApproveActionParams,
      expected: /reason is required/,
    },
  ])("$name", async ({ handler, params, expected }) => {
    const result = await handler().execute({ actionParams: params, context });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(expected);
  });

  it.each([
    { name: "a task that does not exist", handler: () => new TaskHandler(), extra: {} },
    {
      name: "a skip of a task that does not exist",
      handler: () => new SkipHandler(),
      extra: { reason: "gone" },
    },
  ])("$name", async ({ handler, extra }) => {
    context.planReader = readerFor({ getTask: vi.fn().mockResolvedValue(null) });

    const result = await handler().execute({
      actionParams: { target: "task", task_id: "absent", ...extra } as ApproveActionParams,
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });

  it("refuses to skip a task that is already completed", async () => {
    // Skipping finished work would rewrite a record of something that was
    // actually done.
    context.planReader = readerFor({
      getTask: vi.fn().mockResolvedValue({ ...task, status: "completed" }),
    });

    const result = await new SkipHandler().execute({
      actionParams: { target: "skip", task_id: "task-1", reason: "no" },
      context,
    });

    expect(result.isError).toBe(true);
  });

  it("reports a write that fails rather than claiming the approval landed", async () => {
    context.planReader = readerFor({
      approveTask: vi.fn().mockResolvedValue({ success: false, error: "disk full" }),
    });

    const result = await new TaskHandler().execute({
      actionParams: { target: "task", task_id: "task-1" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("disk full");
    expect(updateAll).not.toHaveBeenCalled();
  });

  it("reports a failed skip write too", async () => {
    context.planReader = readerFor({
      updateStatus: vi.fn().mockResolvedValue({ success: false, error: "disk full" }),
    });

    const result = await new SkipHandler().execute({
      actionParams: { target: "skip", task_id: "task-1", reason: "no longer needed" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("disk full");
  });
});
