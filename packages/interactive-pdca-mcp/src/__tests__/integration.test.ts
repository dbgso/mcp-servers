import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PlanReader } from "../services/plan-reader.js";
import { FeedbackReader } from "../services/feedback-reader.js";
import { PlanReporter } from "../services/plan-reporter.js";
import type { PlanActionContext, ApproveActionContext, ReminderConfig } from "../types/index.js";

// Plan handlers
import {
  AddHandler,
  StartHandler,
  ConfirmHandler,
  RequestChangesHandler,
  BlockHandler,
  DeleteHandler,
  InterpretHandler,
  DoSubmitHandler,
  PlanSubmitHandler,
  CheckSubmitHandler,
  ActSubmitHandler,
} from "../tools/plan/handlers/index.js";

// Approve handlers
import {
  TaskHandler,
  SkipHandler,
  DeletionHandler,
  FeedbackHandler as ApproveFeedbackHandler,
} from "../tools/approve/handlers/index.js";

const tempDir = path.join(process.cwd(), "src/__tests__/temp-integration");
const markdownDir = path.join(process.cwd(), "src/__tests__/temp-docs");

describe("Integration Tests", () => {
  let planReader: PlanReader;
  let feedbackReader: FeedbackReader;
  let planReporter: PlanReporter;
  let planContext: PlanActionContext;
  let approveContext: ApproveActionContext;

  // Plan handlers
  let addHandler: AddHandler;
  let startHandler: StartHandler;
  let confirmHandler: ConfirmHandler;
  let requestChangesHandler: RequestChangesHandler;
  let blockHandler: BlockHandler;
  let deleteHandler: DeleteHandler;
  let interpretHandler: InterpretHandler;
  let doSubmitHandler: DoSubmitHandler;
  let planSubmitHandler: PlanSubmitHandler;
  let checkSubmitHandler: CheckSubmitHandler;
  let actSubmitHandler: ActSubmitHandler;

  // Approve handlers
  let taskHandler: TaskHandler;
  let skipHandler: SkipHandler;
  let deletionHandler: DeletionHandler;
  let approveFeedbackHandler: ApproveFeedbackHandler;

  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(markdownDir, { recursive: true });

    planReader = new PlanReader(tempDir);
    feedbackReader = new FeedbackReader(tempDir);
    planReporter = new PlanReporter(tempDir, planReader, feedbackReader);

    planContext = {
      planReader,
      planReporter,
      feedbackReader,
      planDir: tempDir,
      markdownDir,
      config: defaultConfig,
    };

    approveContext = {
      planReader,
      planReporter,
      feedbackReader,
      planDir: tempDir,
      markdownDir,
      config: defaultConfig,
    };

    // Initialize plan handlers
    addHandler = new AddHandler();
    startHandler = new StartHandler();
    confirmHandler = new ConfirmHandler();
    requestChangesHandler = new RequestChangesHandler();
    blockHandler = new BlockHandler();
    deleteHandler = new DeleteHandler();
    interpretHandler = new InterpretHandler();
    doSubmitHandler = new DoSubmitHandler();
    planSubmitHandler = new PlanSubmitHandler();
    checkSubmitHandler = new CheckSubmitHandler();
    actSubmitHandler = new ActSubmitHandler();

    // Initialize approve handlers
    taskHandler = new TaskHandler();
    skipHandler = new SkipHandler();
    deletionHandler = new DeletionHandler();
    approveFeedbackHandler = new ApproveFeedbackHandler();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(markdownDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper to complete __plan phase (required before starting __do)
  async function completePlanPhase(taskId: string) {
    await planReader.updateTask({
      id: `${taskId}__plan`,
      content: "Planning phase",
      completion_criteria: "Plan documented",
    });
    await startHandler.execute({
      rawParams: { id: `${taskId}__plan`, prompt: "Plan" },
      context: planContext,
    });
    await planSubmitHandler.execute({
      rawParams: {
        id: `${taskId}__plan`,
        output_what: "Planned",
        output_why: "Ready",
        output_how: "Analyzed",
        findings: "Analysis complete",
        sources: ["src/main.ts"],
        blockers: [],
        risks: [],
        references_used: [`prompts/${taskId}__plan`],
        references_reason: "Requirements",
        self_review_ref: "_mcp-interactive-instruction__plan__self-review__plan",
      },
      context: planContext,
    });
    await confirmHandler.execute({
      rawParams: { id: `${taskId}__plan` },
      context: planContext,
    });
    await taskHandler.execute({
      actionParams: { task_id: `${taskId}__plan` },
      context: approveContext,
    });
  }

  // ===================
  // A. Normal Flow Tests (7 scenarios)
  // ===================
  describe("A. Normal Flow", () => {
    describe("1. Basic PDCA flow", () => {
      it("should complete add → start → submit_do → confirm → approve", async () => {
        // Add task
        const addResult = await addHandler.execute({
          rawParams: {
            id: "test-task",
            title: "Test Task",
            content: "Test content",
            parent: "",
            dependencies: [],
            prerequisites: "None",
            completion_criteria: "Done",
            deliverables: ["output.txt"],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });
        expect(addResult.isError).toBeFalsy();

        let task = await planReader.getTask("test-task");
        expect(task?.status).toBe("pending");

        // Start task
        const startResult = await startHandler.execute({
          rawParams: { id: "test-task", prompt: "Do the task" },
          context: planContext,
        });
        expect(startResult.isError).toBeFalsy();

        task = await planReader.getTask("test-task");
        expect(task?.status).toBe("in_progress");

        // Complete __plan phase first (required dependency for __do)
        await completePlanPhase("test-task");

        // Now start __do subtask
        await planReader.updateTask({
          id: "test-task__do",
          content: "Implementation work",
          completion_criteria: "Code written",
        });
        await startHandler.execute({
          rawParams: { id: "test-task__do", prompt: "Implement" },
          context: planContext,
        });

        const submitResult = await doSubmitHandler.execute({
          rawParams: {
            id: "test-task__do",
            output_what: "Implemented feature",
            output_why: "Meets requirements",
            output_how: "Wrote code",
            changes: [{ file: "test.ts", lines: "1-10", description: "Added code" }],
            design_decisions: "Simple approach",
            blockers: [],
            risks: [],
            references_used: ["prompts/test-task__do"],
            references_reason: "Task requirements",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });
        expect(submitResult.isError).toBeFalsy();

        task = await planReader.getTask("test-task__do");
        expect(task?.status).toBe("self_review");

        // Confirm
        const confirmResult = await confirmHandler.execute({
          rawParams: { id: "test-task__do" },
          context: planContext,
        });
        expect(confirmResult.isError).toBeFalsy();

        task = await planReader.getTask("test-task__do");
        expect(task?.status).toBe("pending_review");

        // Approve
        const approveResult = await taskHandler.execute({
          actionParams: { task_id: "test-task__do" },
          context: approveContext,
        });
        expect(approveResult.isError).toBeFalsy();

        task = await planReader.getTask("test-task__do");
        expect(task?.status).toBe("completed");
      });
    });

    describe("2. Feedback flow", () => {
      it("should handle request_changes → interpret → approve FB → re-submit", async () => {
        // Setup: create and submit a task
        await addHandler.execute({
          rawParams: {
            id: "fb-task",
            title: "FB Task",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "fb-task", prompt: "Do it" },
          context: planContext,
        });

        // Complete __plan phase first (required dependency for __do)
        await completePlanPhase("fb-task");

        await planReader.updateTask({
          id: "fb-task__do",
          content: "Do work",
          completion_criteria: "Work done",
        });
        await startHandler.execute({
          rawParams: { id: "fb-task__do", prompt: "Implement" },
          context: planContext,
        });

        await doSubmitHandler.execute({
          rawParams: {
            id: "fb-task__do",
            output_what: "First attempt",
            output_why: "Initial",
            output_how: "Wrote code",
            changes: [{ file: "a.ts", lines: "1-5", description: "Code" }],
            design_decisions: "Simple",
            blockers: [],
            risks: [],
            references_used: ["prompts/fb-task__do"],
            references_reason: "Reqs",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });

        await confirmHandler.execute({
          rawParams: { id: "fb-task__do" },
          context: planContext,
        });

        // Request changes
        const rcResult = await requestChangesHandler.execute({
          rawParams: { id: "fb-task__do", comment: "Needs improvement" },
          context: planContext,
        });
        expect(rcResult.isError).toBeFalsy();

        let task = await planReader.getTask("fb-task__do");
        expect(task?.status).toBe("in_progress");

        // Get feedback ID
        const feedbacks = await feedbackReader.listFeedback("fb-task__do");
        expect(feedbacks.length).toBeGreaterThan(0);
        const fbId = feedbacks[0].id;

        // Interpret feedback
        const interpretResult = await interpretHandler.execute({
          rawParams: {
            id: "fb-task__do",
            feedback_id: fbId,
            interpretation: "Will fix the issues",
          },
          context: planContext,
        });
        expect(interpretResult.isError).toBeFalsy();

        // Approve feedback
        const approveFbResult = await approveFeedbackHandler.execute({
          actionParams: { task_id: "fb-task__do", feedback_id: fbId },
          context: approveContext,
        });
        expect(approveFbResult.isError).toBeFalsy();

        // Re-submit
        await doSubmitHandler.execute({
          rawParams: {
            id: "fb-task__do",
            output_what: "Fixed issues",
            output_why: "Addressed feedback",
            output_how: "Rewrote code",
            changes: [{ file: "a.ts", lines: "1-10", description: "Fixed" }],
            design_decisions: "Better approach",
            blockers: [],
            risks: [],
            references_used: ["prompts/fb-task__do"],
            references_reason: "Reqs",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });

        await confirmHandler.execute({
          rawParams: { id: "fb-task__do" },
          context: planContext,
        });

        await taskHandler.execute({
          actionParams: { task_id: "fb-task__do" },
          context: approveContext,
        });

        task = await planReader.getTask("fb-task__do");
        expect(task?.status).toBe("completed");
      });
    });

    describe("3. Skip flow", () => {
      it("should skip task with reason", async () => {
        await addHandler.execute({
          rawParams: {
            id: "skip-task",
            title: "Skip Task",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        const skipResult = await skipHandler.execute({
          actionParams: { task_id: "skip-task", reason: "Not needed" },
          context: approveContext,
        });
        expect(skipResult.isError).toBeFalsy();

        const task = await planReader.getTask("skip-task");
        expect(task?.status).toBe("skipped");
      });
    });

    describe("4. Block → resume flow", () => {
      it("should block and then resume task", async () => {
        await addHandler.execute({
          rawParams: {
            id: "block-task",
            title: "Block Task",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "block-task", prompt: "Do it" },
          context: planContext,
        });

        // Block
        const blockResult = await blockHandler.execute({
          rawParams: { id: "block-task", reason: "Waiting for dependency" },
          context: planContext,
        });
        expect(blockResult.isError).toBeFalsy();

        let task = await planReader.getTask("block-task");
        expect(task?.status).toBe("blocked");

        // Resume via updateStatus (simulating unblock)
        await planReader.updateStatus({ id: "block-task", status: "in_progress" });

        task = await planReader.getTask("block-task");
        expect(task?.status).toBe("in_progress");
      });
    });

    describe("5. Delete flow", () => {
      it("should delete task with approval", async () => {
        await addHandler.execute({
          rawParams: {
            id: "delete-task",
            title: "Delete Task",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        // Delete with force (creates pending deletion requiring approval)
        const deleteResult = await deleteHandler.execute({
          rawParams: { id: "delete-task", force: true },
          context: planContext,
        });
        expect(deleteResult.isError).toBeFalsy();

        // Approve deletion
        const approveDelResult = await deletionHandler.execute({
          actionParams: { task_id: "delete-task" },
          context: approveContext,
        });
        expect(approveDelResult.isError).toBeFalsy();

        const task = await planReader.getTask("delete-task");
        expect(task).toBeNull();
      });
    });

    describe("6. Dependency flow", () => {
      it("should make dependent task ready when dependency completes", async () => {
        // Add task A
        await addHandler.execute({
          rawParams: {
            id: "task-a",
            title: "Task A",
            content: "Content A",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done A",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        // Add task B depending on A
        await addHandler.execute({
          rawParams: {
            id: "task-b",
            title: "Task B",
            content: "Content B",
            parent: "",
            dependencies: ["task-a"],
            dependency_reason: "Needs A first",
            prerequisites: "",
            completion_criteria: "Done B",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        // B should not be in ready tasks
        let readyTasks = await planReader.getReadyTasks();
        expect(readyTasks.map(t => t.id)).not.toContain("task-b");
        expect(readyTasks.map(t => t.id)).toContain("task-a");

        // Skip A to complete it
        await skipHandler.execute({
          actionParams: { task_id: "task-a", reason: "Skipping for test" },
          context: approveContext,
        });

        // B should now be ready
        readyTasks = await planReader.getReadyTasks();
        expect(readyTasks.map(t => t.id)).toContain("task-b");
      });
    });

    describe("7. All 4 PDCA phases", () => {
      it("should handle submit_plan, submit_do, submit_check, submit_act", async () => {
        // Setup task with PDCA subtasks
        await addHandler.execute({
          rawParams: {
            id: "pdca-task",
            title: "PDCA Task",
            content: "Full PDCA",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "All phases done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "pdca-task", prompt: "Do PDCA" },
          context: planContext,
        });

        // Test submit_plan
        await planReader.updateTask({
          id: "pdca-task__plan",
          content: "Research",
          completion_criteria: "Findings documented",
        });
        await startHandler.execute({
          rawParams: { id: "pdca-task__plan", prompt: "Research" },
          context: planContext,
        });

        const planResult = await planSubmitHandler.execute({
          rawParams: {
            id: "pdca-task__plan",
            output_what: "Researched topic",
            output_why: "Found key info",
            output_how: "Read docs",
            findings: "Key findings here",
            sources: ["doc1", "doc2"],
            blockers: [],
            risks: [],
            references_used: ["prompts/pdca-task__plan"],
            references_reason: "Reqs",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__plan",
          },
          context: planContext,
        });
        expect(planResult.isError).toBeFalsy();

        // Complete __plan before __do can start
        await confirmHandler.execute({
          rawParams: { id: "pdca-task__plan" },
          context: planContext,
        });
        await taskHandler.execute({
          actionParams: { task_id: "pdca-task__plan" },
          context: approveContext,
        });

        // Test submit_do
        await planReader.updateTask({
          id: "pdca-task__do",
          content: "Implementation",
          completion_criteria: "Code written",
        });
        await startHandler.execute({
          rawParams: { id: "pdca-task__do", prompt: "Implement" },
          context: planContext,
        });

        const doResult = await doSubmitHandler.execute({
          rawParams: {
            id: "pdca-task__do",
            output_what: "Implemented feature",
            output_why: "Works as designed",
            output_how: "Wrote code",
            changes: [{ file: "feature.ts", lines: "1-50", description: "New feature" }],
            design_decisions: "Simple approach",
            blockers: [],
            risks: [],
            references_used: ["prompts/pdca-task__do"],
            references_reason: "Reqs",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });
        expect(doResult.isError).toBeFalsy();

        // Complete __do before __check can start
        await confirmHandler.execute({
          rawParams: { id: "pdca-task__do" },
          context: planContext,
        });
        await taskHandler.execute({
          actionParams: { task_id: "pdca-task__do" },
          context: approveContext,
        });

        // Test submit_check
        await planReader.updateTask({
          id: "pdca-task__check",
          content: "Verify",
          completion_criteria: "Tests pass",
        });
        await startHandler.execute({
          rawParams: { id: "pdca-task__check", prompt: "Verify" },
          context: planContext,
        });

        const checkResult = await checkSubmitHandler.execute({
          rawParams: {
            id: "pdca-task__check",
            output_what: "Verified implementation",
            output_why: "All tests pass",
            output_how: "Ran test suite",
            test_target: "All modules",
            test_results: "100 tests passed",
            coverage: "95%",
            blockers: [],
            risks: [],
            references_used: ["prompts/pdca-task__check"],
            references_reason: "Reqs",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__check",
          },
          context: planContext,
        });
        expect(checkResult.isError).toBeFalsy();

        // Complete __check before __act can start
        await confirmHandler.execute({
          rawParams: { id: "pdca-task__check" },
          context: planContext,
        });
        await taskHandler.execute({
          actionParams: { task_id: "pdca-task__check" },
          context: approveContext,
        });

        // Test submit_act
        await planReader.updateTask({
          id: "pdca-task__act",
          content: "Address feedback",
          completion_criteria: "FB addressed",
        });
        await startHandler.execute({
          rawParams: { id: "pdca-task__act", prompt: "Address FB" },
          context: planContext,
        });

        const actResult = await actSubmitHandler.execute({
          rawParams: {
            id: "pdca-task__act",
            output_what: "Addressed feedback",
            output_why: "All issues resolved",
            output_how: "Fixed code",
            changes: [{ file: "bugfix.ts", lines: "10-20", description: "Fixed bug" }],
            feedback_addressed: "Fixed bug in module X",
            blockers: [],
            risks: [],
            references_used: ["prompts/pdca-task__act"],
            references_reason: "Reqs",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__act",
          },
          context: planContext,
        });
        expect(actResult.isError).toBeFalsy();
      });
    });
  });

  // ===================
  // B. Error Cases (8 scenarios)
  // ===================
  describe("B. Error Cases", () => {
    describe("8. Invalid start on in_progress", () => {
      it("should reject start on already started task", async () => {
        await addHandler.execute({
          rawParams: {
            id: "started-task",
            title: "Started",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "started-task", prompt: "First start" },
          context: planContext,
        });

        const result = await startHandler.execute({
          rawParams: { id: "started-task", prompt: "Second start" },
          context: planContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Cannot start");
      });
    });

    describe("9. Invalid confirm on pending", () => {
      it("should reject confirm on pending task", async () => {
        await addHandler.execute({
          rawParams: {
            id: "pending-task",
            title: "Pending",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        const result = await confirmHandler.execute({
          rawParams: { id: "pending-task" },
          context: planContext,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("10. Invalid approve on in_progress", () => {
      it("should reject approve on non-pending_review task", async () => {
        await addHandler.execute({
          rawParams: {
            id: "ip-task",
            title: "In Progress",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "ip-task", prompt: "Start" },
          context: planContext,
        });

        const result = await taskHandler.execute({
          actionParams: { task_id: "ip-task" },
          context: approveContext,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("11. Invalid submit on pending", () => {
      it("should reject submit_do on pending task", async () => {
        await addHandler.execute({
          rawParams: {
            id: "not-started",
            title: "Not Started",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        const result = await doSubmitHandler.execute({
          rawParams: {
            id: "not-started",
            output_what: "Done",
            output_why: "Done",
            output_how: "Done",
            changes: [{ file: "a.ts", lines: "1", description: "x" }],
            design_decisions: "x",
            blockers: [],
            risks: [],
            references_used: ["prompts/not-started"],
            references_reason: "x",
            self_review_ref: "x",
          },
          context: planContext,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("12. Non-existent task ID", () => {
      it("should return error for non-existent task", async () => {
        const result = await taskHandler.execute({
          actionParams: { task_id: "non-existent-task" },
          context: approveContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("not found");
      });
    });

    describe("13. Circular dependency", () => {
      it("should reject self-referencing dependency", async () => {
        const result = await addHandler.execute({
          rawParams: {
            id: "self-ref",
            title: "Self Ref",
            content: "Content",
            parent: "",
            dependencies: ["self-ref"],
            dependency_reason: "Depends on itself",
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        expect(result.isError).toBe(true);
        // Self-reference is detected as "missing dependency" since the task doesn't exist yet
        expect(result.content[0].text.toLowerCase()).toContain("missing dependencies");
      });
    });

    describe("14. Missing required parameters", () => {
      it("should reject submit_do without changes", async () => {
        await addHandler.execute({
          rawParams: {
            id: "no-changes",
            title: "No Changes",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "no-changes", prompt: "Start" },
          context: planContext,
        });

        const result = await doSubmitHandler.execute({
          rawParams: {
            id: "no-changes",
            output_what: "Done",
            output_why: "Done",
            output_how: "Done",
            // Missing: changes
            design_decisions: "x",
            blockers: [],
            risks: [],
            references_used: ["prompts/no-changes"],
            references_reason: "x",
            self_review_ref: "x",
          },
          context: planContext,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("15. Wrong phase submit", () => {
      it("should reject submit_do on __plan task", async () => {
        await addHandler.execute({
          rawParams: {
            id: "phase-task",
            title: "Phase Task",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "phase-task", prompt: "Start" },
          context: planContext,
        });

        await planReader.updateTask({
          id: "phase-task__plan",
          content: "Plan",
          completion_criteria: "Planned",
        });
        await startHandler.execute({
          rawParams: { id: "phase-task__plan", prompt: "Plan it" },
          context: planContext,
        });

        // Using submit_do on a __plan task with proper __do self_review_ref
        // Should fail because submit_do expects task ID to NOT end with __plan
        const result = await doSubmitHandler.execute({
          rawParams: {
            id: "phase-task__plan",
            output_what: "Done",
            output_why: "Done",
            output_how: "Done",
            changes: [{ file: "a.ts", lines: "1", description: "x" }],
            design_decisions: "x",
            blockers: [],
            risks: [],
            references_used: ["prompts/phase-task__plan"],
            references_reason: "x",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });

        expect(result.isError).toBe(true);
        // Error message tells you to use submit_plan instead of submit_do
        expect(result.content[0].text).toContain("submit_plan");
      });
    });
  });

  // ===================
  // C. Edge Cases (5 scenarios)
  // ===================
  describe("C. Edge Cases", () => {
    describe("16. Nested PDCA subtasks", () => {
      it("should auto-create 4 PDCA subtasks on start", async () => {
        await addHandler.execute({
          rawParams: {
            id: "nested-task",
            title: "Nested Task",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "nested-task", prompt: "Do it" },
          context: planContext,
        });

        // Check 4 subtasks exist
        const planTask = await planReader.getTask("nested-task__plan");
        const doTask = await planReader.getTask("nested-task__do");
        const checkTask = await planReader.getTask("nested-task__check");
        const actTask = await planReader.getTask("nested-task__act");

        expect(planTask).not.toBeNull();
        expect(doTask).not.toBeNull();
        expect(checkTask).not.toBeNull();
        expect(actTask).not.toBeNull();

        expect(planTask?.parent).toBe("nested-task");
        expect(doTask?.parent).toBe("nested-task");
      });
    });

    describe("17. Multiple feedback rounds", () => {
      it("should handle 2 request_changes cycles", async () => {
        // Setup task
        await addHandler.execute({
          rawParams: {
            id: "multi-fb",
            title: "Multi FB",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "multi-fb", prompt: "Do it" },
          context: planContext,
        });

        // Complete __plan phase first
        await completePlanPhase("multi-fb");

        await planReader.updateTask({
          id: "multi-fb__do",
          content: "Do",
          completion_criteria: "Done",
        });
        await startHandler.execute({
          rawParams: { id: "multi-fb__do", prompt: "Implement" },
          context: planContext,
        });

        // First round
        await doSubmitHandler.execute({
          rawParams: {
            id: "multi-fb__do",
            output_what: "Attempt 1",
            output_why: "First try",
            output_how: "Code",
            changes: [{ file: "a.ts", lines: "1", description: "x" }],
            design_decisions: "x",
            blockers: [],
            risks: [],
            references_used: ["prompts/multi-fb__do"],
            references_reason: "x",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });
        await confirmHandler.execute({
          rawParams: { id: "multi-fb__do" },
          context: planContext,
        });

        await requestChangesHandler.execute({
          rawParams: { id: "multi-fb__do", comment: "FB 1" },
          context: planContext,
        });

        let feedbacks = await feedbackReader.listFeedback("multi-fb__do");
        await interpretHandler.execute({
          rawParams: {
            id: "multi-fb__do",
            feedback_id: feedbacks[0].id,
            interpretation: "Will fix",
          },
          context: planContext,
        });
        await approveFeedbackHandler.execute({
          actionParams: { task_id: "multi-fb__do", feedback_id: feedbacks[0].id },
          context: approveContext,
        });

        // Second round
        await doSubmitHandler.execute({
          rawParams: {
            id: "multi-fb__do",
            output_what: "Attempt 2",
            output_why: "Second try",
            output_how: "More code",
            changes: [{ file: "a.ts", lines: "1-5", description: "y" }],
            design_decisions: "y",
            blockers: [],
            risks: [],
            references_used: ["prompts/multi-fb__do"],
            references_reason: "y",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });
        await confirmHandler.execute({
          rawParams: { id: "multi-fb__do" },
          context: planContext,
        });

        await requestChangesHandler.execute({
          rawParams: { id: "multi-fb__do", comment: "FB 2" },
          context: planContext,
        });

        feedbacks = await feedbackReader.listFeedback("multi-fb__do");
        expect(feedbacks.length).toBe(2);
      });
    });

    describe("18. Rapid sequential operations", () => {
      it("should handle rapid add→start→submit→confirm sequence", async () => {
        await addHandler.execute({
          rawParams: {
            id: "rapid-task",
            title: "Rapid",
            content: "Content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "rapid-task", prompt: "Go" },
          context: planContext,
        });

        // Complete __plan phase first
        await completePlanPhase("rapid-task");

        await planReader.updateTask({
          id: "rapid-task__do",
          content: "Do",
          completion_criteria: "Done",
        });
        await startHandler.execute({
          rawParams: { id: "rapid-task__do", prompt: "Go" },
          context: planContext,
        });

        await doSubmitHandler.execute({
          rawParams: {
            id: "rapid-task__do",
            output_what: "Done",
            output_why: "Done",
            output_how: "Done",
            changes: [{ file: "a.ts", lines: "1", description: "x" }],
            design_decisions: "x",
            blockers: [],
            risks: [],
            references_used: ["prompts/rapid-task__do"],
            references_reason: "x",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });

        await confirmHandler.execute({
          rawParams: { id: "rapid-task__do" },
          context: planContext,
        });

        const task = await planReader.getTask("rapid-task__do");
        expect(task?.status).toBe("pending_review");
      });
    });

    describe("19. PENDING_REVIEW.md content", () => {
      it("should generate PENDING_REVIEW.md with task details", async () => {
        await addHandler.execute({
          rawParams: {
            id: "review-content",
            title: "Review Content Task",
            content: "Test content",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: ["output.txt"],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await startHandler.execute({
          rawParams: { id: "review-content", prompt: "Do it" },
          context: planContext,
        });

        // Complete __plan phase first
        await completePlanPhase("review-content");

        await planReader.updateTask({
          id: "review-content__do",
          content: "Do work",
          completion_criteria: "Work done",
        });
        await startHandler.execute({
          rawParams: { id: "review-content__do", prompt: "Implement" },
          context: planContext,
        });

        await doSubmitHandler.execute({
          rawParams: {
            id: "review-content__do",
            output_what: "Implemented feature XYZ",
            output_why: "Meets all requirements",
            output_how: "Wrote TypeScript code",
            changes: [{ file: "feature.ts", lines: "1-50", description: "New feature" }],
            design_decisions: "Used factory pattern",
            blockers: [],
            risks: [],
            references_used: ["prompts/review-content__do"],
            references_reason: "Task requirements",
            self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
          },
          context: planContext,
        });

        await confirmHandler.execute({
          rawParams: { id: "review-content__do" },
          context: planContext,
        });

        // Check PENDING_REVIEW.md exists and has content
        const pendingReviewPath = path.join(tempDir, "PENDING_REVIEW.md");
        const content = await fs.readFile(pendingReviewPath, "utf-8");

        expect(content).toContain("review-content__do");
        expect(content).toContain("Implemented feature XYZ");
        expect(content).toContain("feature.ts");
      });
    });

    describe("20. GRAPH.md content", () => {
      it("should generate GRAPH.md with dependencies", async () => {
        await addHandler.execute({
          rawParams: {
            id: "graph-a",
            title: "Graph A",
            content: "Content A",
            parent: "",
            dependencies: [],
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await addHandler.execute({
          rawParams: {
            id: "graph-b",
            title: "Graph B",
            content: "Content B",
            parent: "",
            dependencies: ["graph-a"],
            dependency_reason: "Needs A",
            prerequisites: "",
            completion_criteria: "Done",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          },
          context: planContext,
        });

        await planReporter.updateAll();

        const graphPath = path.join(tempDir, "GRAPH.md");
        const content = await fs.readFile(graphPath, "utf-8");

        // Note: Mermaid escapes hyphens to underscores
        expect(content).toContain("graph_a");
        expect(content).toContain("graph_b");
        expect(content).toContain("-->"); // Dependency arrow
      });
    });
  });
});
