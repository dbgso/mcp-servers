/**
 * Draft Workflow Tests
 *
 * Tests for the draft workflow state machine.
 * Flow: editing → self_review → user_reviewing → pending_approval → applied
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  draftWorkflow,
  type DraftState,
  type DraftContext,
  type DraftParams,
} from "../workflows/draft-workflow.js";
import { createWorkflowInstance } from "mcp-shared";

// mcp-shared is mocked globally in vitest-setup.ts

describe("Draft Workflow", () => {
  describe("State Transitions", () => {
    let instance: ReturnType<typeof createWorkflowInstance<DraftState, DraftContext, DraftParams>>;

    beforeEach(() => {
      instance = createWorkflowInstance({
        definition: draftWorkflow,
        initialContext: {
          draftId: "test-draft",
          content: "",
        },
      });
    });

    describe("editing → self_review", () => {
      it("should fail without content", async () => {
        const result = await instance.trigger({ params: { action: "submit" } });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorType).toBe("precondition_failed");
          expect(result.error).toContain("Content");
        }
      });

      it("should succeed with content in params", async () => {
        const result = await instance.trigger({
          params: { action: "submit", content: "# Test Content" },
        });
        expect(result.ok).toBe(true);
        expect(instance.state).toBe("self_review");
        expect(instance.context.content).toBe("# Test Content");
      });

      it("should succeed with content already in context", async () => {
        // Create instance with content already set
        const instanceWithContent = createWorkflowInstance({
          definition: draftWorkflow,
          initialContext: {
            draftId: "test-draft",
            content: "# Existing Content",
          },
        });
        const result = await instanceWithContent.trigger({ params: { action: "submit" } });
        expect(result.ok).toBe(true);
        expect(instanceWithContent.state).toBe("self_review");
      });
    });

    describe("self_review → user_reviewing", () => {
      beforeEach(async () => {
        await instance.trigger({
          params: { action: "submit", content: "# Test" },
        });
      });

      it("should fail without notes", async () => {
        const result = await instance.trigger({
          params: { action: "review_complete" },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorType).toBe("precondition_failed");
          expect(result.error).toContain("notes");
        }
      });

      it("should succeed with notes", async () => {
        const result = await instance.trigger({
          params: { action: "review_complete", notes: "Reviewed and looks good" },
        });
        expect(result.ok).toBe(true);
        expect(instance.state).toBe("user_reviewing");
        expect(instance.context.selfReviewNotes).toBe("Reviewed and looks good");
      });
    });

    describe("user_reviewing → pending_approval", () => {
      beforeEach(async () => {
        await instance.trigger({
          params: { action: "submit", content: "# Test" },
        });
        await instance.trigger({
          params: { action: "review_complete", notes: "OK" },
        });
      });

      it("should fail without confirmed flag", async () => {
        const result = await instance.trigger({
          params: { action: "confirm" },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorType).toBe("precondition_failed");
          expect(result.error).toContain("confirm");
        }
      });

      it("should fail with confirmed: false", async () => {
        const result = await instance.trigger({
          params: { action: "confirm", confirmed: false },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorType).toBe("precondition_failed");
        }
      });

      it("should succeed with confirmed: true", async () => {
        const result = await instance.trigger({
          params: { action: "confirm", confirmed: true },
        });
        expect(result.ok).toBe(true);
        expect(instance.state).toBe("pending_approval");
      });
    });

    describe("pending_approval → applied", () => {
      beforeEach(async () => {
        await instance.trigger({
          params: { action: "submit", content: "# Test" },
        });
        await instance.trigger({
          params: { action: "review_complete", notes: "OK" },
        });
        await instance.trigger({
          params: { action: "confirm", confirmed: true },
        });
      });

      it("should require approval (no token = approval_required error)", async () => {
        const result = await instance.trigger({
          params: { action: "approve" },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorType).toBe("approval_required");
        }
      });

      it("should fail with invalid approval token", async () => {
        const result = await instance.trigger({
          params: { action: "approve" },
          approvalToken: "invalid-token",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorType).toBe("approval_invalid");
        }
      });
    });

    describe("Full workflow path", () => {
      it("should track visited states correctly", async () => {
        await instance.trigger({
          params: { action: "submit", content: "# Test" },
        });
        await instance.trigger({
          params: { action: "review_complete", notes: "LGTM" },
        });
        await instance.trigger({
          params: { action: "confirm", confirmed: true },
        });

        expect(instance.visitedStates).toEqual([
          "editing",
          "self_review",
          "user_reviewing",
          "pending_approval",
        ]);
      });
    });
  });

  describe("State skipping prevention", () => {
    it("should prevent skipping self_review via stateVisited check", async () => {
      const instance = createWorkflowInstance({
        definition: draftWorkflow,
        initialContext: {
          draftId: "test",
          content: "# Test",
        },
        options: {
          restoredState: "user_reviewing",
          restoredVisitedStates: ["editing"], // Missing self_review!
        },
      });

      const result = await instance.trigger({
        params: { action: "confirm", confirmed: true },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("self_review");
        expect(result.error).toContain("visited");
      }
    });

    it("should prevent skipping user_reviewing via stateVisited check", async () => {
      const instance = createWorkflowInstance({
        definition: draftWorkflow,
        initialContext: {
          draftId: "test",
          content: "# Test",
        },
        options: {
          restoredState: "pending_approval",
          restoredVisitedStates: ["editing", "self_review"], // Missing user_reviewing!
        },
      });

      const result = await instance.trigger({
        params: { action: "approve" },
        approvalToken: "1234",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("user_reviewing");
        expect(result.error).toContain("visited");
      }
    });
  });
});
