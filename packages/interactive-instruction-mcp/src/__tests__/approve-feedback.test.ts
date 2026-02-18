import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PlanReader } from "../services/plan-reader.js";
import { PlanReporter } from "../services/plan-reporter.js";
import { FeedbackReader } from "../services/feedback-reader.js";

const tempDir = path.join(process.cwd(), "src/__tests__/temp-approve-feedback");

describe("approveFeedback updateAll integration", () => {
  let planReader: PlanReader;
  let planReporter: PlanReporter;
  let feedbackReader: FeedbackReader;

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    planReader = new PlanReader(tempDir);
    feedbackReader = new FeedbackReader(tempDir);
    planReporter = new PlanReporter(tempDir, planReader, feedbackReader);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should update PENDING_REVIEW.md when feedback is confirmed", async () => {
    // Setup: create a task
    await planReader.addTask({
      id: "test-task",
      title: "Test Task",
      content: "Test content",
      parent: "",
      dependencies: [],
      dependency_reason: "",
      prerequisites: "None",
      completion_criteria: "Done",
      deliverables: [],
      is_parallelizable: false,
      references: [],
    });

    // Create draft feedback with interpretation
    const fbResult = await feedbackReader.createDraftFeedback({
      taskId: "test-task",
      original: "Test feedback",
      decision: "adopted",
    });
    expect(fbResult.success).toBe(true);

    // Add interpretation
    await feedbackReader.addInterpretation({
      taskId: "test-task",
      feedbackId: fbResult.feedbackId ?? "",
      interpretation: "Interpretation of feedback",
    });

    // Generate initial PENDING_REVIEW.md
    await planReporter.updateAll();

    // Verify feedback appears in PENDING_REVIEW.md
    const pendingReviewPath = path.join(tempDir, "PENDING_REVIEW.md");
    let content = await fs.readFile(pendingReviewPath, "utf-8");
    expect(content).toContain("Test feedback");
    expect(content).toContain("Interpretation of feedback");

    // Confirm feedback
    const confirmResult = await feedbackReader.confirmFeedback({
      taskId: "test-task",
      feedbackId: fbResult.feedbackId ?? "",
    });
    expect(confirmResult.success).toBe(true);

    // Update PENDING_REVIEW.md (this is what approveFeedback now does)
    await planReporter.updateAll();

    // Verify feedback no longer appears in PENDING_REVIEW.md
    content = await fs.readFile(pendingReviewPath, "utf-8");
    expect(content).not.toContain("Test feedback");
    expect(content).not.toContain("Interpretation of feedback");
  });

  it("should remove confirmed feedback from PENDING_REVIEW.md", async () => {
    // Setup: create a task
    await planReader.addTask({
      id: "task-with-fb",
      title: "Task with Feedback",
      content: "Content",
      parent: "",
      dependencies: [],
      dependency_reason: "",
      prerequisites: "",
      completion_criteria: "",
      deliverables: [],
      is_parallelizable: false,
      references: [],
    });

    // Create multiple feedbacks with delay to ensure different timestamps
    const fb1 = await feedbackReader.createDraftFeedback({
      taskId: "task-with-fb",
      original: "Feedback 1",
      decision: "adopted",
    });
    expect(fb1.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const fb2 = await feedbackReader.createDraftFeedback({
      taskId: "task-with-fb",
      original: "Feedback 2",
      decision: "adopted",
    });
    expect(fb2.success).toBe(true);

    // Add interpretations
    const interp1 = await feedbackReader.addInterpretation({
      taskId: "task-with-fb",
      feedbackId: fb1.feedbackId ?? "",
      interpretation: "Interp 1",
    });
    expect(interp1.success).toBe(true);

    const interp2 = await feedbackReader.addInterpretation({
      taskId: "task-with-fb",
      feedbackId: fb2.feedbackId ?? "",
      interpretation: "Interp 2",
    });
    expect(interp2.success).toBe(true);

    // Generate PENDING_REVIEW.md
    await planReporter.updateAll();

    const pendingReviewPath = path.join(tempDir, "PENDING_REVIEW.md");
    let content = await fs.readFile(pendingReviewPath, "utf-8");
    expect(content).toContain("Feedback 1");
    expect(content).toContain("Feedback 2");

    // Confirm only fb1
    await feedbackReader.confirmFeedback({
      taskId: "task-with-fb",
      feedbackId: fb1.feedbackId ?? "",
    });

    // Update PENDING_REVIEW.md
    await planReporter.updateAll();

    content = await fs.readFile(pendingReviewPath, "utf-8");
    expect(content).not.toContain("Feedback 1");
    expect(content).toContain("Feedback 2");
  });
});
