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
} from "../utils/workflow.js";
import * as approvalModule from "../utils/approval.js";

// Test types
type TestState = "draft" | "review" | "approved" | "rejected";

interface TestContext {
  content: string;
  reviewComment?: string;
}

interface TestParams {
  action?: "approve" | "reject";
  comment?: string;
}

// Test workflow definition
const testWorkflowDef: WorkflowDefinition<TestState, TestContext, TestParams> = {
  id: "test-workflow",
  states: ["draft", "review", "approved", "rejected"],
  initial: "draft",
  transitions: [
    {
      from: ["draft"],
      preconditions: [fieldRequired("content")],
      action: async () => ({ nextState: "review" as const }),
    },
    {
      from: ["review"],
      action: async (_ctx, params) => {
        if (params.action === "approve") {
          return { nextState: "approved" as const };
        }
        return { nextState: "rejected" as const };
      },
    },
  ],
};

describe("Workflow", () => {
  describe("defineWorkflow", () => {
    it("should create a valid workflow definition", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      expect(workflow.id).toBe("test-workflow");
      expect(workflow.states).toEqual(["draft", "review", "approved", "rejected"]);
      expect(workflow.initial).toBe("draft");
    });

    it("should throw error for invalid initial state", () => {
      expect(() =>
        defineWorkflow({
          id: "invalid",
          states: ["a", "b"],
          initial: "c" as "a",
          transitions: [],
        })
      ).toThrow('Initial state "c" is not in states list');
    });

    it("should throw error for invalid transition state", () => {
      expect(() =>
        defineWorkflow({
          id: "invalid",
          states: ["a", "b"],
          initial: "a",
          transitions: [
            {
              from: ["c" as "a"],
              action: async () => ({ nextState: "b" as const }),
            },
          ],
        })
      ).toThrow('Transition \'from\' state "c" is not in states list');
    });
  });

  describe("createWorkflowInstance", () => {
    it("should create an instance with initial state", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "test" } });

      expect(instance.state).toBe("draft");
      expect(instance.context.content).toBe("test");
      expect(instance.visitedStates).toEqual(["draft"]);
    });

    it("should generate instance ID with workflow prefix", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "test" } });

      expect(instance.id).toMatch(/^test-workflow-\d+$/);
    });

    it("should use provided instance ID", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: { content: "test" },
        options: { instanceId: "custom-id" },
      });

      expect(instance.id).toBe("custom-id");
    });
  });

  describe("canTrigger", () => {
    it("should return allowed when preconditions pass", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "test" } });

      const result = instance.canTrigger({});
      expect(result.allowed).toBe(true);
    });

    it("should return not allowed when preconditions fail", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "" } });

      const result = instance.canTrigger({});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("content");
    });

    it("should indicate when approval is required", () => {
      const workflowWithApproval = defineWorkflow<TestState, TestContext, TestParams>({
        ...testWorkflowDef,
        transitions: [
          {
            from: ["draft"],
            requiresApproval: true,
            action: async () => ({ nextState: "review" }),
          },
        ],
      });
      const instance = createWorkflowInstance({ definition: workflowWithApproval, initialContext: { content: "test" } });

      const result = instance.canTrigger({});
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("trigger", () => {
    it("should transition to next state on success", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "test" } });

      const result = await instance.trigger({ params: {} });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.from).toBe("draft");
        expect(result.to).toBe("review");
      }
      expect(instance.state).toBe("review");
      expect(instance.visitedStates).toContain("review");
    });

    it("should fail when preconditions not met", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "" } });

      const result = await instance.trigger({ params: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("precondition_failed");
      }
      expect(instance.state).toBe("draft");
    });

    it("should handle dynamic next state based on params", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "test" } });

      // First transition to review
      await instance.trigger({ params: {} });
      expect(instance.state).toBe("review");

      // Approve
      const result = await instance.trigger({ params: { action: "approve" } });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.to).toBe("approved");
      }
    });

    it("should fail when no transition defined for current state", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { content: "test" } });

      await instance.trigger({ params: {} });  // draft -> review
      await instance.trigger({ params: { action: "approve" } });  // review -> approved

      // No transition from approved
      const result = await instance.trigger({ params: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("no_transition");
      }
    });
  });

  describe("Precondition Validators", () => {
    describe("fieldRequired", () => {
      it("should pass for non-empty string", () => {
        const validator = fieldRequired<TestContext>("content");
        expect(validator.validate({ content: "test" })).toBe(true);
      });

      it("should fail for empty string", () => {
        const validator = fieldRequired<TestContext>("content");
        expect(validator.validate({ content: "" })).toBe(false);
      });

      it("should fail for null/undefined", () => {
        const validator = fieldRequired<{ value: string | null }>("value");
        expect(validator.validate({ value: null })).toBe(false);
      });
    });

    describe("fieldMinLength", () => {
      it("should pass for string with sufficient length", () => {
        const validator = fieldMinLength<TestContext>({ field: "content", min: 5 });
        expect(validator.validate({ content: "hello" })).toBe(true);
      });

      it("should fail for string with insufficient length", () => {
        const validator = fieldMinLength<TestContext>({ field: "content", min: 5 });
        expect(validator.validate({ content: "hi" })).toBe(false);
      });

      it("should work with arrays", () => {
        const validator = fieldMinLength<{ items: string[] }>({ field: "items", min: 2 });
        expect(validator.validate({ items: ["a", "b"] })).toBe(true);
        expect(validator.validate({ items: ["a"] })).toBe(false);
      });
    });

    describe("stateVisited", () => {
      it("should pass when state was visited", () => {
        const validator = stateVisited<{ _visitedStates?: string[] }>("draft");
        expect(validator.validate({ _visitedStates: ["draft", "review"] })).toBe(true);
      });

      it("should fail when state was not visited", () => {
        const validator = stateVisited<{ _visitedStates?: string[] }>("approved");
        expect(validator.validate({ _visitedStates: ["draft", "review"] })).toBe(false);
      });
    });

    describe("customValidator", () => {
      it("should use custom validation function", () => {
        const validator = customValidator<TestContext>({
          check: (ctx) => ctx.content.startsWith("valid"),
          message: "Content must start with 'valid'",
        });
        expect(validator.validate({ content: "valid content" })).toBe(true);
        expect(validator.validate({ content: "invalid" })).toBe(false);
        expect(validator.getMessage()).toBe("Content must start with 'valid'");
      });
    });
  });

  describe("Serialization", () => {
    it("should serialize workflow state", () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: { content: "test" },
        options: { instanceId: "test-instance" },
      });

      const serialized = instance.serialize();
      expect(serialized.workflowId).toBe("test-workflow");
      expect(serialized.instanceId).toBe("test-instance");
      expect(serialized.currentState).toBe("draft");
      expect(serialized.context.content).toBe("test");
      expect(serialized.visitedStates).toEqual(["draft"]);
    });
  });

  describe("Persistence", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = path.join(os.tmpdir(), `workflow-test-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should save and load workflow state", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: { content: "test" },
        options: { instanceId: "persist-test" },
      });

      // Make a transition
      await instance.trigger({ params: {} });
      expect(instance.state).toBe("review");

      // Save
      const filePath = path.join(tempDir, "workflow.json");
      await instance.save(filePath);

      // Load
      const result = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instance.state).toBe("review");
        expect(result.instance.id).toBe("persist-test");
        expect(result.instance.visitedStates).toContain("draft");
        expect(result.instance.visitedStates).toContain("review");
      }
    });

    it("should return error for non-existent file", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const result = await loadWorkflowInstance({ definition: workflow, filePath: "/non/existent/file.json" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("file_not_found");
        expect(result.error).toContain("File not found");
      }
    });

    it("should return error for invalid JSON", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const filePath = path.join(tempDir, "invalid.json");
      await fs.writeFile(filePath, "not valid json{", "utf-8");

      const result = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("parse_error");
        expect(result.error).toContain("Failed to parse JSON");
      }
    });

    it("should return error for invalid workflow state structure", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const filePath = path.join(tempDir, "invalid-structure.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({ invalid: "structure" }),
        "utf-8"
      );

      const result = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("parse_error");
        expect(result.error).toContain("Invalid workflow state structure");
      }
    });

    it("should return error for workflow ID mismatch", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const filePath = path.join(tempDir, "mismatch.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          workflowId: "different-workflow",
          instanceId: "test",
          currentState: "draft",
          context: { content: "test" },
          visitedStates: ["draft"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        "utf-8"
      );

      const result = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("workflow_mismatch");
        expect(result.error).toContain("Workflow ID mismatch");
      }
    });

    it("should return success with instance for valid file", async () => {
      const workflow = defineWorkflow(testWorkflowDef);
      const instance = createWorkflowInstance({
        definition: workflow,
        initialContext: { content: "test" },
        options: { instanceId: "result-test" },
      });

      const filePath = path.join(tempDir, "valid.json");
      await instance.save(filePath);

      const result = await loadWorkflowInstance({ definition: workflow, filePath });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instance.id).toBe("result-test");
        expect(result.instance.state).toBe("draft");
      }
    });
  });

  describe("Multiple from states", () => {
    it("should allow transition from multiple source states", async () => {
      type MultiState = "a" | "b" | "c" | "done";
      const multiFromWorkflow = defineWorkflow<MultiState, { value: number }, object>({
        id: "multi-from",
        states: ["a", "b", "c", "done"],
        initial: "a",
        transitions: [
          {
            from: ["a"],
            action: async () => ({ nextState: "b" }),
          },
          {
            from: ["b", "c"],
            action: async () => ({ nextState: "done" }),
          },
        ],
      });

      // Start at "a", go to "b"
      const instance = createWorkflowInstance({ definition: multiFromWorkflow, initialContext: { value: 1 } });
      await instance.trigger({ params: {} });
      expect(instance.state).toBe("b");

      // From "b", should be able to go to "done"
      const result = await instance.trigger({ params: {} });
      expect(result.ok).toBe(true);
      expect(instance.state).toBe("done");
    });

    it("should check preconditions for multi-from transitions", () => {
      type MultiState = "a" | "b" | "done";
      const workflow = defineWorkflow<MultiState, { ready: string | null }, object>({
        id: "multi-precond",
        states: ["a", "b", "done"],
        initial: "a",
        transitions: [
          {
            from: ["a", "b"],
            preconditions: [fieldRequired("ready")],
            action: async () => ({ nextState: "done" }),
          },
        ],
      });

      // null triggers fieldRequired precondition failure
      const instance = createWorkflowInstance({ definition: workflow, initialContext: { ready: null } });
      const result = instance.canTrigger({});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("ready");
    });
  });

  describe("Error handling", () => {
    it("should handle action that throws an error", async () => {
      type ErrState = "start" | "end";
      const errorWorkflow = defineWorkflow<ErrState, object, object>({
        id: "error-workflow",
        states: ["start", "end"],
        initial: "start",
        transitions: [
          {
            from: ["start"],
            action: async () => {
              throw new Error("Action failed!");
            },
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: errorWorkflow, initialContext: {} });
      const result = await instance.trigger({ params: {} });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("action_failed");
        expect(result.error).toBe("Action failed!");
      }
      // State should remain unchanged
      expect(instance.state).toBe("start");
    });

    it("should handle non-Error throws", async () => {
      type ErrState = "start" | "end";
      const errorWorkflow = defineWorkflow<ErrState, object, object>({
        id: "string-error",
        states: ["start", "end"],
        initial: "start",
        transitions: [
          {
            from: ["start"],
            action: async () => {
              throw "string error";
            },
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: errorWorkflow, initialContext: {} });
      const result = await instance.trigger({ params: {} });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("string error");
      }
    });
  });

  describe("Approval flow", () => {
    it("should require approval when requiresApproval is true", async () => {
      const approvalWorkflow = defineWorkflow<TestState, TestContext, TestParams>({
        id: "approval-workflow",
        states: ["draft", "review", "approved", "rejected"],
        initial: "draft",
        transitions: [
          {
            from: ["draft"],
            requiresApproval: true,
            action: async () => ({ nextState: "review" }),
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: approvalWorkflow, initialContext: { content: "test" } });

      // Without approval token, should fail
      const result = await instance.trigger({ params: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("approval_required");
        expect(result.approvalId).toBeDefined();
      }
      expect(instance.state).toBe("draft");
    });

    it("should use requiresApproval function for dynamic approval", async () => {
      const dynamicApprovalWorkflow = defineWorkflow<TestState, TestContext, TestParams>({
        id: "dynamic-approval",
        states: ["draft", "review", "approved", "rejected"],
        initial: "draft",
        transitions: [
          {
            from: ["draft"],
            requiresApproval: (params) => params.action === "approve",
            action: async () => ({ nextState: "review" }),
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: dynamicApprovalWorkflow, initialContext: { content: "test" } });

      // Without approval-triggering action, should succeed
      const result1 = await instance.trigger({ params: {} });
      expect(result1.ok).toBe(true);
    });

    it("should indicate approval requirement in canTrigger", () => {
      const approvalWorkflow = defineWorkflow<TestState, TestContext, TestParams>({
        id: "approval-check",
        states: ["draft", "review", "approved", "rejected"],
        initial: "draft",
        transitions: [
          {
            from: ["draft"],
            requiresApproval: true,
            action: async () => ({ nextState: "review" }),
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: approvalWorkflow, initialContext: { content: "test" } });
      const canTriggerResult = instance.canTrigger({});

      expect(canTriggerResult.allowed).toBe(true);
      expect(canTriggerResult.requiresApproval).toBe(true);
    });

    it("should require approval when dynamic requiresApproval returns true", async () => {
      const dynamicApprovalWorkflow = defineWorkflow<TestState, TestContext, TestParams>({
        id: "dynamic-approval-required",
        states: ["draft", "review", "approved", "rejected"],
        initial: "draft",
        transitions: [
          {
            from: ["draft"],
            requiresApproval: (params) => params.action === "approve",
            action: async () => ({ nextState: "review" }),
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: dynamicApprovalWorkflow, initialContext: { content: "test" } });

      // With approval-triggering action, should require approval
      const result = await instance.trigger({ params: { action: "approve" } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("approval_required");
        expect(result.approvalId).toBeDefined();
      }
    });

    it("should succeed when valid approval token is provided", async () => {
      // Mock approval functions
      const mockToken = "1234";
      vi.spyOn(approvalModule, "requestApproval").mockResolvedValue({
        token: mockToken,
        fallbackPath: "/tmp/test-approval.txt",
      });
      vi.spyOn(approvalModule, "validateApproval").mockReturnValue({
        valid: true,
      });

      const approvalWorkflow = defineWorkflow<TestState, TestContext, TestParams>({
        id: "approval-success",
        states: ["draft", "review", "approved", "rejected"],
        initial: "draft",
        transitions: [
          {
            from: ["draft"],
            requiresApproval: true,
            action: async () => ({ nextState: "review" }),
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: approvalWorkflow, initialContext: { content: "test" } });

      // With valid approval token, should succeed
      const result = await instance.trigger({ params: {}, approvalToken: mockToken });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.from).toBe("draft");
        expect(result.to).toBe("review");
      }
      expect(instance.state).toBe("review");

      // Restore mocks
      vi.restoreAllMocks();
    });

    it("should fail with approval_invalid when token is invalid", async () => {
      // Mock approval functions
      vi.spyOn(approvalModule, "requestApproval").mockResolvedValue({
        token: "1234",
        fallbackPath: "/tmp/test-approval.txt",
      });
      vi.spyOn(approvalModule, "validateApproval").mockReturnValue({
        valid: false,
        reason: "invalid_token",
      });

      const approvalWorkflow = defineWorkflow<TestState, TestContext, TestParams>({
        id: "approval-invalid",
        states: ["draft", "review", "approved", "rejected"],
        initial: "draft",
        transitions: [
          {
            from: ["draft"],
            requiresApproval: true,
            action: async () => ({ nextState: "review" }),
          },
        ],
      });

      const instance = createWorkflowInstance({ definition: approvalWorkflow, initialContext: { content: "test" } });

      // With invalid approval token, should fail
      const result = await instance.trigger({ params: {}, approvalToken: "wrong-token" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorType).toBe("approval_invalid");
        expect(result.error).toContain("invalid_token");
      }
      expect(instance.state).toBe("draft");

      // Restore mocks
      vi.restoreAllMocks();
    });
  });
});
