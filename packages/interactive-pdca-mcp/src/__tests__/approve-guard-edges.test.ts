/**
 * What `approve(target: "feedback" | "deletion")` refuses.
 *
 * Both are confirmations of something prepared earlier -- an interpreted piece
 * of feedback, a deletion staged for review -- so every guard here is a check
 * that the earlier step actually happened. Confirming feedback that has no
 * interpretation, or a deletion nobody staged, would mark work reviewed that
 * nobody has read.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { FeedbackHandler } from "../tools/approve/handlers/feedback-handler.js";
import { DeletionHandler } from "../tools/approve/handlers/deletion-handler.js";
import type {
  ApproveActionContext,
  ApproveActionParams,
  FeedbackReader,
  PlanReader,
  PlanReporter,
} from "../types/index.js";

const interpreted = {
  id: "fb-1",
  task_id: "task-1",
  content: "this needs a second look",
  interpretation: "rework the parser",
  status: "pending",
  created: "",
};

let context: ApproveActionContext;
let updateAll: ReturnType<typeof vi.fn>;

function contextWith(params: {
  feedback?: Record<string, unknown>;
  reader?: Record<string, unknown>;
}): ApproveActionContext {
  updateAll = vi.fn().mockResolvedValue(undefined);
  return {
    markdownDir: "/tmp/markdown",
    planReader: {
      getPendingDeletion: vi.fn().mockResolvedValue({ task_id: "task-1" }),
      executePendingDeletion: vi
        .fn()
        .mockResolvedValue({ success: true, deleted: ["task-1", "task-1__do"] }),
      ...params.reader,
    } as unknown as PlanReader,
    planReporter: { updateAll } as unknown as PlanReporter,
    feedbackReader: {
      getFeedback: vi.fn().mockResolvedValue(interpreted),
      confirmFeedback: vi.fn().mockResolvedValue({ success: true }),
      ...params.feedback,
    } as unknown as FeedbackReader,
  };
}

const text = (r: { content: { type: string; text: string }[] }) =>
  r.content.map((c) => c.text).join("\n");

beforeEach(() => {
  context = contextWith({});
});

describe("confirming feedback", () => {
  it("goes through when the feedback has been interpreted", async () => {
    const result = await new FeedbackHandler().execute({
      actionParams: { target: "feedback", task_id: "task-1", feedback_id: "fb-1" },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(updateAll).toHaveBeenCalled();
  });

  it.each([
    {
      name: "no task id",
      params: { target: "feedback", feedback_id: "fb-1" },
      expected: /task_id is required/,
    },
    {
      name: "no feedback id",
      params: { target: "feedback", task_id: "task-1" },
      expected: /feedback_id is required/,
    },
  ])("refuses a call with $name", async ({ params, expected }) => {
    const result = await new FeedbackHandler().execute({
      actionParams: params as ApproveActionParams,
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(expected);
  });

  it("says so when the feedback is not there", async () => {
    context = contextWith({ feedback: { getFeedback: vi.fn().mockResolvedValue(null) } });

    const result = await new FeedbackHandler().execute({
      actionParams: { target: "feedback", task_id: "task-1", feedback_id: "absent" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });

  it("refuses feedback nobody has interpreted yet, and says how to", async () => {
    // The interpretation is the AI's account of what the feedback asks for.
    // Confirming without one marks the comment handled with nothing recorded
    // about what handling it means.
    context = contextWith({
      feedback: {
        getFeedback: vi.fn().mockResolvedValue({ ...interpreted, interpretation: "" }),
      },
    });

    const result = await new FeedbackHandler().execute({
      actionParams: { target: "feedback", task_id: "task-1", feedback_id: "fb-1" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('action: "interpret"');
  });

  it("reports a confirmation that could not be written", async () => {
    context = contextWith({
      feedback: {
        confirmFeedback: vi.fn().mockResolvedValue({ success: false, error: "already confirmed" }),
      },
    });

    const result = await new FeedbackHandler().execute({
      actionParams: { target: "feedback", task_id: "task-1", feedback_id: "fb-1" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("already confirmed");
    expect(updateAll).not.toHaveBeenCalled();
  });
});

describe("confirming a staged deletion", () => {
  it("lists every task the cascade removed", async () => {
    const result = await new DeletionHandler().execute({
      actionParams: { target: "deletion", task_id: "task-1" },
      context,
    });

    expect(text(result)).toContain("Cascade deleted 2 tasks");
    expect(text(result)).toContain("- task-1__do");
    expect(updateAll).toHaveBeenCalled();
  });

  it("copes with a cascade that reports no list", async () => {
    // `deleted` is optional on the result, and a count of `0 tasks` with an
    // empty list is the honest reading of a result that carries neither.
    context = contextWith({
      reader: { executePendingDeletion: vi.fn().mockResolvedValue({ success: true }) },
    });

    const result = await new DeletionHandler().execute({
      actionParams: { target: "deletion", task_id: "task-1" },
      context,
    });

    expect(text(result)).toContain("Cascade deleted 0 tasks");
  });

  it("refuses a call with no task id", async () => {
    const result = await new DeletionHandler().execute({
      actionParams: { target: "deletion" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/task_id is required/);
  });

  it("says so when no deletion was staged", async () => {
    // Deletion is two steps on purpose: `plan(action: "delete")` stages it and
    // this approves it. Approving without a staged request would delete on one
    // call.
    context = contextWith({ reader: { getPendingDeletion: vi.fn().mockResolvedValue(null) } });

    const result = await new DeletionHandler().execute({
      actionParams: { target: "deletion", task_id: "task-1" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No pending deletion");
  });

  it("reports a cascade that failed rather than claiming a deletion", async () => {
    context = contextWith({
      reader: {
        executePendingDeletion: vi
          .fn()
          .mockResolvedValue({ success: false, error: "a child is locked" }),
      },
    });

    const result = await new DeletionHandler().execute({
      actionParams: { target: "deletion", task_id: "task-1" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("a child is locked");
    expect(updateAll).not.toHaveBeenCalled();
  });
});
