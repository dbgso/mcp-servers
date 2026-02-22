/**
 * Draft Workflow Definition
 *
 * Manages the lifecycle of documentation drafts:
 * editing → self_review → user_reviewing → pending_approval → applied
 *
 * Key design:
 * - At user_reviewing, AI must explain content to user in their own words
 * - Tool does NOT show content at this stage to force AI to explain
 * - When confirmed, tool shows diff/summary as supplementary info + sends notification
 */

import * as path from "node:path";
import * as os from "node:os";
import {
  defineWorkflow,
  fieldRequired,
  stateVisited,
  customValidator,
  WorkflowManager,
  type WorkflowDefinition,
} from "mcp-shared";

// Workflow states
export type DraftState =
  | "editing"
  | "self_review"
  | "user_reviewing"
  | "pending_approval"
  | "applied";

// Context stored with each draft workflow
export interface DraftContext {
  draftId: string;
  content: string;
  selfReviewNotes?: string;
  approvalToken?: string;
}

// Parameters for triggering transitions
export interface DraftParams {
  action?: "submit" | "review_complete" | "confirm" | "approve";
  content?: string;
  notes?: string;
  confirmed?: boolean;
}

// Workflow definition
const draftWorkflowDefinition: WorkflowDefinition<DraftState, DraftContext, DraftParams> = {
  id: "draft-workflow",
  states: ["editing", "self_review", "user_reviewing", "pending_approval", "applied"],
  initial: "editing",
  transitions: [
    // editing → self_review: Submit draft for self-review
    {
      from: ["editing"],
      preconditions: [
        fieldRequired("draftId"),
        // content can be in ctx OR params (params takes precedence)
        customValidator<DraftContext, DraftParams>({
          check: (ctx, params) => !!(ctx.content || params.content),
          message: "Content is required (provide via content param or set in context)",
        }),
      ],
      action: async (ctx, params) => {
        if (params.content) {
          ctx.content = params.content;
        }
        return { nextState: "self_review" };
      },
    },
    // self_review → user_reviewing: Complete self-review with notes
    // AI must then explain to user in their own words
    {
      from: ["self_review"],
      preconditions: [
        customValidator<DraftContext, DraftParams>({
          check: (_, params) => params.action === "review_complete" && !!params.notes,
          message: "Must provide review notes (action: 'review_complete', notes: '...')",
        }),
      ],
      action: async (ctx, params) => {
        ctx.selfReviewNotes = params.notes;
        return { nextState: "user_reviewing" };
      },
    },
    // user_reviewing → pending_approval: User confirms they've seen AI's explanation
    // At this point, tool shows diff/summary and sends approval notification
    {
      from: ["user_reviewing"],
      preconditions: [
        stateVisited("self_review"),
        customValidator({
          check: (_, params) => params.action === "confirm" && params.confirmed === true,
          message: "Must confirm user has seen explanation (action: 'confirm', confirmed: true)",
        }),
      ],
      action: async () => {
        return { nextState: "pending_approval" };
      },
    },
    // pending_approval → applied: Apply with approval token (requires real approval)
    {
      from: ["pending_approval"],
      preconditions: [
        stateVisited("user_reviewing"),
      ],
      requiresApproval: true,
      action: async (ctx) => {
        ctx.approvalToken = "approved";
        return { nextState: "applied" };
      },
    },
  ],
};

// Export the defined workflow
export const draftWorkflow = defineWorkflow(draftWorkflowDefinition);

// State descriptions for user-facing messages
export const stateDescriptions: Record<DraftState, string> = {
  editing: "Draft is being edited",
  self_review: "AI must self-review the draft content",
  user_reviewing: "AI must explain content to user in their own words, then call with confirmed: true",
  pending_approval: "Waiting for user approval (token required)",
  applied: "Draft has been applied to documentation",
};

// Next action hints for each state
export const nextActionHints: Record<DraftState, string> = {
  editing: "Call draft(action: 'approve', id: '<id>', content: '<content>') to submit for self-review",
  self_review: "Call draft(action: 'approve', id: '<id>', notes: '<review notes>') after reviewing",
  user_reviewing: "Explain the content to the user in your own words. After user confirms, call draft(action: 'approve', id: '<id>', confirmed: true)",
  pending_approval: "Desktop notification sent. User must approve with token: draft(action: 'approve', id: '<id>', approvalToken: '<token>')",
  applied: "Workflow complete",
};

// Persistence directory
const PERSIST_DIR = path.join(os.tmpdir(), "mcp-draft-workflows");

// Workflow manager instance
export const draftWorkflowManager = new WorkflowManager<DraftState, DraftContext, DraftParams>({
  definition: draftWorkflow,
  persistDir: PERSIST_DIR,
  createInitialContext: (id) => ({
    draftId: id,
    content: "",
  }),
});
