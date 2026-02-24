/**
 * Workflow Integration Tests
 *
 * These tests verify the workflow library works correctly in realistic scenarios
 * without mocking (except for desktop notifications).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  defineWorkflow,
  createWorkflowInstance,
  loadWorkflowInstance,
  fieldRequired,
  fieldMinLength,
  stateVisited,
  customValidator,
  type WorkflowDefinition,
  type WorkflowInstance,
} from "../utils/workflow.js";

// Mock only the desktop notification (not the approval logic)
vi.mock("node-notifier", () => ({
  default: {
    notify: vi.fn(),
  },
}));

describe("Workflow Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `workflow-integration-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Document Review Workflow", () => {
    // Realistic document review workflow
    type DocState = "draft" | "review" | "revision" | "approved" | "published";
    interface DocContext {
      title: string;
      content: string;
      author: string;
      reviewComments: string[];
      approvedBy?: string;
    }
    interface DocParams {
      action?: "submit" | "approve" | "reject" | "revise" | "publish";
      comment?: string;
      approver?: string;
    }

    const docWorkflow: WorkflowDefinition<DocState, DocContext, DocParams> = {
      id: "document-review",
      states: ["draft", "review", "revision", "approved", "published"],
      initial: "draft",
      transitions: [
        {
          from: ["draft"],
          preconditions: [
            fieldRequired("title"),
            fieldRequired("content"),
            fieldMinLength({ field: "content", min: 10 }),
          ],
          action: async () => ({ nextState: "review" }),
        },
        {
          from: ["review"],
          action: async (ctx, params) => {
            if (params.action === "approve") {
              ctx.approvedBy = params.approver;
              return { nextState: "approved" };
            }
            if (params.comment) {
              ctx.reviewComments.push(params.comment);
            }
            return { nextState: "revision" };
          },
        },
        {
          from: ["revision"],
          preconditions: [
            customValidator({
              check: (ctx) => ctx.reviewComments.length > 0,
              message: "Must address review comments before resubmitting",
            }),
          ],
          action: async () => ({ nextState: "review" }),
        },
        {
          from: ["approved"],
          preconditions: [stateVisited("review")],
          action: async () => ({ nextState: "published" }),
        },
      ],
    };

    it("should complete full document review lifecycle", async () => {
      const workflow = defineWorkflow(docWorkflow);
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: {
          title: "Integration Test Guide",
          content: "This is a comprehensive guide to integration testing.",
          author: "Test Author",
          reviewComments: [],
        },
      });

      // Step 1: Draft -> Review
      expect(instance.state).toBe("draft");
      let result = await instance.trigger({ params: { action: "submit" } });
      expect(result.ok).toBe(true);
      expect(instance.state).toBe("review");

      // Step 2: Review -> Revision (with comments)
      result = await instance.trigger({
        params: { action: "reject", comment: "Please add more examples" },
      });
      expect(result.ok).toBe(true);
      expect(instance.state).toBe("revision");
      expect(instance.context.reviewComments).toContain("Please add more examples");

      // Step 3: Revision -> Review
      result = await instance.trigger({ params: { action: "revise" } });
      expect(result.ok).toBe(true);
      expect(instance.state).toBe("review");

      // Step 4: Review -> Approved
      result = await instance.trigger({
        params: { action: "approve", approver: "Senior Reviewer" },
      });
      expect(result.ok).toBe(true);
      expect(instance.state).toBe("approved");
      expect(instance.context.approvedBy).toBe("Senior Reviewer");

      // Step 5: Approved -> Published
      result = await instance.trigger({ params: { action: "publish" } });
      expect(result.ok).toBe(true);
      expect(instance.state).toBe("published");

      // Verify all states were visited
      expect(instance.visitedStates).toEqual([
        "draft",
        "review",
        "revision",
        "approved",
        "published",
      ]);
    });

    it("should persist and restore workflow state across sessions", async () => {
      const workflow = defineWorkflow(docWorkflow);
      const filePath = path.join(tempDir, "document-workflow.json");

      // Session 1: Create and progress workflow
      const instance1 = createWorkflowInstance({
        definition: workflow,
        initialContext: {
          title: "Persistent Document",
          content: "Content that spans multiple sessions.",
          author: "Persistent Author",
          reviewComments: [],
        },
        options: { instanceId: "persistent-doc-1" },
      });

      await instance1.trigger({ params: {} }); // draft -> review
      await instance1.trigger({ params: { comment: "Review comment" } }); // review -> revision
      await instance1.save(filePath);

      // Session 2: Load and continue
      const loadResult = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      const instance2 = loadResult.instance;
      expect(instance2.id).toBe("persistent-doc-1");
      expect(instance2.state).toBe("revision");
      expect(instance2.context.reviewComments).toContain("Review comment");
      expect(instance2.visitedStates).toContain("review");

      // Continue workflow
      await instance2.trigger({ params: {} }); // revision -> review
      expect(instance2.state).toBe("review");

      // Save again
      await instance2.save(filePath);

      // Session 3: Verify state persisted
      const loadResult2 = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(loadResult2.ok).toBe(true);
      if (loadResult2.ok) {
        expect(loadResult2.instance.state).toBe("review");
        expect(loadResult2.instance.visitedStates).toEqual([
          "draft",
          "review",
          "revision",
        ]);
      }
    });

    it.each([
      { name: "empty content", content: "", expectedError: "content" },
      { name: "short content", content: "Short", expectedError: "at least 10" },
      { name: "missing title", content: "Valid content here", title: "", expectedError: "title" },
    ])("should reject $name", async ({ content, title = "Test", expectedError }) => {
      const workflow = defineWorkflow(docWorkflow);
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: {
          title,
          content,
          author: "Author",
          reviewComments: [],
        },
      });

      const result = await instance.trigger({ params: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("precondition_failed");
        expect(result.error).toContain(expectedError);
      }
    });
  });

  describe("Multi-stage Approval Workflow", () => {
    // Workflow with multiple approval stages
    type ApprovalState = "pending" | "level1" | "level2" | "final" | "rejected";
    interface ApprovalContext {
      requestId: string;
      amount: number;
      approvals: string[];
    }
    interface ApprovalParams {
      approve?: boolean;
      approver?: string;
    }

    const createApprovalWorkflow = (
      thresholds: { level1: number; level2: number }
    ): WorkflowDefinition<ApprovalState, ApprovalContext, ApprovalParams> => ({
      id: "multi-approval",
      states: ["pending", "level1", "level2", "final", "rejected"],
      initial: "pending",
      transitions: [
        {
          from: ["pending"],
          action: async (ctx) => {
            // Route based on amount
            if (ctx.amount <= thresholds.level1) {
              return { nextState: "level1" };
            }
            if (ctx.amount <= thresholds.level2) {
              return { nextState: "level2" };
            }
            return { nextState: "final" };
          },
        },
        {
          from: ["level1"],
          action: async (ctx, params) => {
            if (params.approve && params.approver) {
              ctx.approvals.push(`L1: ${params.approver}`);
              return { nextState: "final" };
            }
            return { nextState: "rejected" };
          },
        },
        {
          from: ["level2"],
          action: async (ctx, params) => {
            if (params.approve && params.approver) {
              ctx.approvals.push(`L2: ${params.approver}`);
              return { nextState: "level1" };
            }
            return { nextState: "rejected" };
          },
        },
        {
          from: ["final"],
          preconditions: [
            customValidator({
              check: (ctx) => ctx.approvals.length > 0,
              message: "At least one approval required",
            }),
          ],
          action: async () => ({ nextState: "final" }), // Terminal state
        },
      ],
    });

    it.each([
      {
        name: "low-value (single approval)",
        amount: 500,
        expectedRoute: "level1",
        approvalSteps: [{ approve: true, approver: "Manager" }],
        expectedApprovals: ["L1: Manager"],
      },
      {
        name: "mid-value (two approvals)",
        amount: 3000,
        expectedRoute: "level2",
        approvalSteps: [
          { approve: true, approver: "Director" },
          { approve: true, approver: "Manager" },
        ],
        expectedApprovals: ["L2: Director", "L1: Manager"],
      },
      {
        name: "high-value (direct to final)",
        amount: 10000,
        expectedRoute: "final",
        approvalSteps: [],
        expectedApprovals: [],
      },
    ])(
      "should route $name requests correctly",
      async ({ amount, expectedRoute, approvalSteps, expectedApprovals }) => {
        const workflow = defineWorkflow(
          createApprovalWorkflow({ level1: 1000, level2: 5000 })
        );
        const instance = createWorkflowInstance({
          definition: workflow,
          initialContext: {
            requestId: `REQ-${amount}`,
            amount,
            approvals: [],
          },
        });

        // Initial routing
        await instance.trigger({ params: {} });
        expect(instance.state).toBe(expectedRoute);

        // Process approval steps
        for (const step of approvalSteps) {
          await instance.trigger({ params: step });
        }

        // Verify final state
        if (approvalSteps.length > 0) {
          expect(instance.state).toBe("final");
        }
        expect(instance.context.approvals).toEqual(expectedApprovals);
      }
    );

    it.each([
      { stage: "level1", amount: 500 },
      { stage: "level2", amount: 3000 },
    ])("should handle rejection at $stage", async ({ amount }) => {
      const workflow = defineWorkflow(
        createApprovalWorkflow({ level1: 1000, level2: 5000 })
      );
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: {
          requestId: `REQ-reject-${amount}`,
          amount,
          approvals: [],
        },
      });

      await instance.trigger({ params: {} });
      await instance.trigger({ params: { approve: false } });
      expect(instance.state).toBe("rejected");
    });
  });

  describe("Concurrent Workflow Instances", () => {
    type SimpleState = "start" | "middle" | "end";
    const simpleWorkflow = defineWorkflow<SimpleState, { id: number }, object>({
      id: "simple",
      states: ["start", "middle", "end"],
      initial: "start",
      transitions: [
        { from: ["start"], action: async () => ({ nextState: "middle" }) },
        { from: ["middle"], action: async () => ({ nextState: "end" }) },
      ],
    });

    it("should handle multiple instances independently", async () => {
      const instances: WorkflowInstance<SimpleState, { id: number }, object>[] = [];

      // Create 5 instances
      for (let i = 0; i < 5; i++) {
        instances.push(
          createWorkflowInstance({
            definition: simpleWorkflow,
            initialContext: { id: i },
            options: { instanceId: `instance-${i}` },
          })
        );
      }

      // Progress some instances
      await instances[0].trigger({ params: {} }); // -> middle
      await instances[0].trigger({ params: {} }); // -> end
      await instances[2].trigger({ params: {} }); // -> middle
      await instances[4].trigger({ params: {} }); // -> middle

      // Verify independent states
      expect(instances[0].state).toBe("end");
      expect(instances[1].state).toBe("start");
      expect(instances[2].state).toBe("middle");
      expect(instances[3].state).toBe("start");
      expect(instances[4].state).toBe("middle");
    });

    it("should persist multiple instances to separate files", async () => {
      const instance1 = createWorkflowInstance({
        definition: simpleWorkflow,
        initialContext: { id: 1 },
        options: { instanceId: "multi-1" },
      });
      const instance2 = createWorkflowInstance({
        definition: simpleWorkflow,
        initialContext: { id: 2 },
        options: { instanceId: "multi-2" },
      });

      await instance1.trigger({ params: {} }); // -> middle
      await instance2.trigger({ params: {} }); // -> middle
      await instance2.trigger({ params: {} }); // -> end

      const file1 = path.join(tempDir, "multi-1.json");
      const file2 = path.join(tempDir, "multi-2.json");
      await instance1.save(file1);
      await instance2.save(file2);

      // Load and verify
      const loaded1 = await loadWorkflowInstance({ definition: simpleWorkflow, filePath: file1 });
      const loaded2 = await loadWorkflowInstance({ definition: simpleWorkflow, filePath: file2 });

      expect(loaded1.ok && loaded1.instance.state).toBe("middle");
      expect(loaded2.ok && loaded2.instance.state).toBe("end");
    });
  });
});
