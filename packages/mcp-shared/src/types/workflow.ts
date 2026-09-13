/**
 * Workflow State Machine Types
 */

import type { ApprovalOptions, ApprovalRequest, ApprovalResult } from "../utils/approval/core.js";

/**
 * How a `requiresApproval` transition asks for, and proves, approval.
 *
 * Injected rather than imported. The engine used to call
 * `utils/approval/core.js` directly, which put `node-notifier` in the module
 * graph of everything that imported `mcp-shared/workflow` -- including servers
 * that gate nothing on a token and deliberately carry no notifier. The
 * dependency was invisible: nothing in the workflow API mentioned
 * notifications, and the bundle check was what found it.
 *
 * `mcp-shared/approval` exports `tokenWorkflowApproval`, which is this
 * interface over the token flow. A caller that wants the old behaviour passes
 * it; a caller that passes nothing cannot use `requiresApproval` at all, and is
 * told so rather than silently proceeding.
 */
export interface WorkflowApproval {
  request(params: {
    request: ApprovalRequest;
    options?: ApprovalOptions;
  }): Promise<{ fallbackPath: string }>;
  validate(params: { requestId: string; providedToken: string }): ApprovalResult;
}

/**
 * Precondition validator interface (Strategy pattern)
 */
export interface PreconditionValidator<TContext, TParams = unknown> {
  validate(ctx: TContext, params: TParams): boolean;
  getMessage(): string;
}

/**
 * Context extended with visited states for stateVisited validator
 * @internal
 */
export type ContextWithVisitedStates<TContext> = TContext & {
  _visitedStates: string[];
};

/**
 * Transition result
 */
export type TransitionResult<TState extends string> =
  | { ok: true; from: TState; to: TState }
  | {
      ok: false;
      error: string;
      errorType:
        | "precondition_failed"
        | "no_transition"
        | "approval_required"
        | "approval_invalid"
        | "action_failed";
      approvalId?: string;
      approvalFallbackPath?: string;
    };

/**
 * Transition definition
 */
export interface TransitionDefinition<
  TState extends string,
  TContext,
  TParams,
> {
  from: TState[];
  preconditions?: PreconditionValidator<TContext, TParams>[];
  requiresApproval?: boolean | ((params: TParams) => boolean);
  action: (
    ctx: TContext,
    params: TParams
  ) => Promise<{ nextState: TState }>;
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition<
  TState extends string,
  TContext,
  TParams,
> {
  id: string;
  states: TState[];
  initial: TState;
  transitions: TransitionDefinition<TState, TContext, TParams>[];
}

/**
 * Serialized workflow state
 */
export interface SerializedWorkflowState<TState extends string, TContext> {
  workflowId: string;
  instanceId: string;
  currentState: TState;
  context: TContext;
  visitedStates: TState[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Type guard to validate serialized workflow state structure
 */
export function isSerializedWorkflowState(
  value: unknown
): value is SerializedWorkflowState<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.workflowId === "string" &&
    typeof obj.instanceId === "string" &&
    typeof obj.currentState === "string" &&
    typeof obj.context === "object" &&
    obj.context !== null &&
    Array.isArray(obj.visitedStates) &&
    obj.visitedStates.every((s) => typeof s === "string") &&
    typeof obj.createdAt === "string" &&
    typeof obj.updatedAt === "string"
  );
}

/**
 * Load workflow result
 */
export type LoadWorkflowResult<TState extends string, TContext, TParams> =
  | { ok: true; instance: WorkflowInstance<TState, TContext, TParams> }
  | {
      ok: false;
      error: string;
      errorType: "file_not_found" | "read_error" | "parse_error" | "workflow_mismatch";
    };

/**
 * Workflow instance
 */
export interface WorkflowInstance<TState extends string, TContext, TParams> {
  readonly id: string;
  readonly workflowId: string;
  readonly state: TState;
  readonly context: TContext;
  readonly visitedStates: TState[];

  /**
   * Trigger a transition
   */
  trigger(args: {
    params: TParams;
    approvalToken?: string;
  }): Promise<TransitionResult<TState>>;

  /**
   * Check if a transition can be triggered
   */
  canTrigger(params: TParams): {
    allowed: boolean;
    reason?: string;
    requiresApproval?: boolean;
  };

  /**
   * Serialize the workflow state
   */
  serialize(): SerializedWorkflowState<TState, TContext>;

  /**
   * Save the workflow state to a file
   */
  save(filePath?: string): Promise<string>;
}

/**
 * Workflow instance options
 */
export interface WorkflowInstanceOptions<TState extends string = string> {
  instanceId?: string;
  persistDir?: string;
  approvalOptions?: ApprovalOptions;
  /** Required by any transition with `requiresApproval`. See `WorkflowApproval`. */
  approval?: WorkflowApproval;
  /** Restore from saved state */
  restoredState?: TState;
  restoredVisitedStates?: TState[];
  /** Restore timestamps */
  restoredCreatedAt?: string;
  restoredUpdatedAt?: string;
}
