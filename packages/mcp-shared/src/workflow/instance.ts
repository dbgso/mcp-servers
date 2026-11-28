/**
 * Workflow Instance Management
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
// Type-only: importing these as values is what dragged `node-notifier` into
// every bundle that touched the workflow engine.
import type { ApprovalOptions, ApprovalRequest } from "../utils/approval/core.js";
import {
  isSerializedWorkflowState,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowInstanceOptions,
  type PreconditionValidator,
  type TransitionDefinition,
  type TransitionResult,
  type SerializedWorkflowState,
  type LoadWorkflowResult,
  type ContextWithVisitedStates,
  type WorkflowApproval,
} from "../types/workflow.js";
import { getErrorMessage } from "../utils/error.js";

const DEFAULT_PERSIST_DIR = path.join(os.tmpdir(), "mcp-workflow");

/**
 * Filename a workflow instance's state is persisted under.
 *
 * Percent-encoding is what makes this safe to reverse: it is injective, so two
 * ids can never land on the same file, and `instanceIdFromStateFileName` can
 * recover the id exactly. An earlier version collapsed `__` to `_` on the way
 * in and doubled every `_` on the way out, which meant state was written under
 * one name and looked for under another, and ids came back mangled.
 *
 * Ids made only of unreserved characters (the common case) encode to
 * themselves, so this keeps reading the files the old save path wrote.
 */
export function workflowStateFileName(instanceId: string): string {
  return `${encodeURIComponent(instanceId)}.json`;
}

/**
 * Inverse of `workflowStateFileName`. Returns null for a name that this module
 * did not write, rather than guessing at an id.
 */
export function instanceIdFromStateFileName(fileName: string): string | null {
  if (!fileName.endsWith(".json")) return null;
  try {
    return decodeURIComponent(fileName.slice(0, -".json".length));
  } catch {
    return null;
  }
}

/**
 * A transition that wants approval, in a workflow given no way to obtain it,
 * must not proceed. Saying so beats the alternatives: importing a default flow
 * here is what coupled every consumer to the notifier, and treating the absence
 * as "approved" would turn a misconfiguration into an ungated write.
 */
const MISSING_APPROVAL_FLOW: TransitionResult<never> = {
  ok: false,
  error:
    "This transition requires approval, but the workflow was created without an `approval` flow. Pass one in `WorkflowInstanceOptions.approval` -- `tokenWorkflowApproval` from `mcp-shared/approval` is the token-and-notification implementation.",
  errorType: "approval_invalid",
};

/**
 * Why a precondition refused the transition. The fallback is not dead code:
 * `getMessage` is the caller's own implementation and is free to return nothing,
 * and a refusal still owes the caller a reason.
 */
function preconditionFailure(
  failedMessage: string | undefined
): TransitionResult<never> {
  return {
    ok: false,
    error: failedMessage ?? "Precondition failed",
    errorType: "precondition_failed",
  };
}

function resolveInstanceIdentity(params: {
  workflowId: string;
  options: { instanceId?: string; persistDir?: string };
}): { instanceId: string; persistDir: string } {
  const { workflowId, options } = params;
  return {
    instanceId: options.instanceId ?? `${workflowId}-${Date.now()}`,
    persistDir: options.persistDir ?? DEFAULT_PERSIST_DIR,
  };
}

function restoredOrInitialState<TState extends string>(params: {
  initial: TState;
  options: WorkflowInstanceOptions<TState>;
}): { currentState: TState; visitedStates: TState[] } {
  const { initial, options } = params;
  return {
    currentState: options.restoredState ?? initial,
    visitedStates: options.restoredVisitedStates
      ? [...options.restoredVisitedStates]
      : [initial],
  };
}

/**
 * Each field falls back on its own, so restoring a state does not oblige the
 * caller to supply its timestamps too.
 */
function restoredOrFreshTimestamps(options: {
  restoredCreatedAt?: string;
  restoredUpdatedAt?: string;
}): { createdAt: string; updatedAt: string } {
  const createdAt = options.restoredCreatedAt ?? new Date().toISOString();
  return { createdAt, updatedAt: options.restoredUpdatedAt ?? createdAt };
}

class WorkflowInstanceImpl<TState extends string, TContext, TParams>
  implements WorkflowInstance<TState, TContext, TParams>
{
  private readonly definition: WorkflowDefinition<TState, TContext, TParams>;
  private readonly contextValue: TContext;
  private readonly instanceId: string;
  private readonly persistDir: string;
  private readonly approvalOptions: ApprovalOptions | undefined;
  private readonly approval: WorkflowApproval | undefined;
  private readonly visited: TState[];
  private readonly createdAt: string;
  private currentState: TState;
  private updatedAt: string;

  constructor(params: {
    definition: WorkflowDefinition<TState, TContext, TParams>;
    initialContext: TContext;
    options: WorkflowInstanceOptions<TState>;
  }) {
    const { definition, initialContext, options } = params;
    const { instanceId, persistDir } = resolveInstanceIdentity({
      workflowId: definition.id,
      options,
    });
    const { currentState, visitedStates } = restoredOrInitialState({
      initial: definition.initial,
      options,
    });
    const { createdAt, updatedAt } = restoredOrFreshTimestamps(options);

    this.definition = definition;
    this.contextValue = { ...initialContext };
    this.instanceId = instanceId;
    this.persistDir = persistDir;
    this.approvalOptions = options.approvalOptions;
    this.approval = options.approval;
    this.currentState = currentState;
    this.visited = visitedStates;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  get id(): string {
    return this.instanceId;
  }

  get workflowId(): string {
    return this.definition.id;
  }

  get state(): TState {
    return this.currentState;
  }

  get context(): TContext {
    // Deep, not `{ ...context }`. The getter exists so a caller cannot edit
    // the workflow's state without a transition, and a shallow copy only
    // achieves that for primitive fields -- an array or object in the
    // context stayed shared, so `instance.context.items.push(...)` reached
    // straight through. Anything a context may hold is already required to
    // survive `JSON.stringify` in `save()`, so cloning it structurally
    // cannot reject a context this engine otherwise supports.
    return structuredClone(this.contextValue);
  }

  get visitedStates(): TState[] {
    return [...this.visited];
  }

  canTrigger(triggerParams: TParams): {
    allowed: boolean;
    reason?: string;
    requiresApproval?: boolean;
  } {
    const transition = this.findTransition();
    if (!transition) {
      return {
        allowed: false,
        reason: `No transition defined for state "${this.currentState}"`,
      };
    }

    const failing = this.failingPrecondition({ transition, triggerParams });
    if (failing) {
      return { allowed: false, reason: failing.getMessage() };
    }

    return {
      allowed: true,
      requiresApproval: this.isApprovalRequired({ transition, triggerParams }),
    };
  }

  async trigger(args: {
    params: TParams;
    approvalToken?: string;
  }): Promise<TransitionResult<TState>> {
    const { params: triggerParams, approvalToken } = args;
    const transition = this.findTransition();
    if (!transition) {
      return {
        ok: false,
        error: `No transition defined for state "${this.currentState}"`,
        errorType: "no_transition",
      };
    }

    const refusal = await this.refusalBeforeAction({
      transition,
      triggerParams,
      approvalToken,
    });
    if (refusal) {
      return refusal;
    }

    return this.applyTransition({ transition, triggerParams });
  }

  serialize(): SerializedWorkflowState<TState, TContext> {
    return {
      workflowId: this.definition.id,
      instanceId: this.instanceId,
      currentState: this.currentState,
      context: this.contextValue,
      visitedStates: [...this.visited],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  async save(filePath?: string): Promise<string> {
    const targetPath =
      filePath ??
      path.join(this.persistDir, workflowStateFileName(this.instanceId));

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const serialized = this.serialize();
    await fs.writeFile(targetPath, JSON.stringify(serialized, null, 2), "utf-8");

    return targetPath;
  }

  /**
   * Find the first transition that matches the current state
   */
  private findTransition():
    | TransitionDefinition<TState, TContext, TParams>
    | undefined {
    return this.definition.transitions.find((t) =>
      t.from.includes(this.currentState)
    );
  }

  /**
   * The first validator that refuses the transition, or undefined when they all
   * pass. Returning the validator rather than a verdict is what lets
   * `canTrigger` and `trigger` word the refusal differently without asking
   * twice.
   */
  private failingPrecondition(params: {
    transition: TransitionDefinition<TState, TContext, TParams>;
    triggerParams: TParams;
  }): PreconditionValidator<TContext, TParams> | undefined {
    const { transition, triggerParams } = params;
    const { preconditions } = transition;
    if (!preconditions) {
      return undefined;
    }

    // Inject visited states into context for stateVisited validator
    const ctxWithVisited: ContextWithVisitedStates<TContext> = {
      ...this.contextValue,
      _visitedStates: this.visited as string[],
    };

    // Validators expecting TContext will work with extended context
    return preconditions.find(
      (validator) => !validator.validate(ctxWithVisited, triggerParams)
    );
  }

  /**
   * Check if approval is required for a transition
   */
  private isApprovalRequired(params: {
    transition: TransitionDefinition<TState, TContext, TParams>;
    triggerParams: TParams;
  }): boolean {
    const { transition, triggerParams } = params;
    if (typeof transition.requiresApproval === "function") {
      return transition.requiresApproval(triggerParams);
    }
    return transition.requiresApproval === true;
  }

  /**
   * Everything that can refuse a transition before its action runs, as the
   * result to return -- or null when nothing does.
   */
  private async refusalBeforeAction(params: {
    transition: TransitionDefinition<TState, TContext, TParams>;
    triggerParams: TParams;
    approvalToken: string | undefined;
  }): Promise<TransitionResult<TState> | null> {
    const { transition, triggerParams, approvalToken } = params;
    const failing = this.failingPrecondition({ transition, triggerParams });
    if (failing) {
      return preconditionFailure(failing.getMessage());
    }

    if (!this.isApprovalRequired({ transition, triggerParams })) {
      return null;
    }

    return this.handleApproval({
      approvalToken,
      approvalRequestId: `${this.instanceId}-${this.currentState}`,
    });
  }

  /**
   * Handle approval flow: request or validate approval token
   * @returns null if approved, TransitionResult if approval needed or invalid
   */
  private async handleApproval(params: {
    approvalToken: string | undefined;
    approvalRequestId: string;
  }): Promise<TransitionResult<TState> | null> {
    const { approvalToken, approvalRequestId } = params;
    const { approval } = this;
    if (approval === undefined) {
      return MISSING_APPROVAL_FLOW;
    }

    if (!approvalToken) {
      return this.requestApproval({ approval, approvalRequestId });
    }

    return this.validateApprovalToken({
      approval,
      approvalRequestId,
      approvalToken,
    });
  }

  private async requestApproval(params: {
    approval: WorkflowApproval;
    approvalRequestId: string;
  }): Promise<TransitionResult<TState>> {
    const { approval, approvalRequestId } = params;
    const approvalRequest: ApprovalRequest = {
      id: approvalRequestId,
      operation: `Workflow: ${this.definition.id}`,
      description: `Transition from "${this.currentState}"`,
    };

    const { fallbackPath } = await approval.request({
      request: approvalRequest,
      options: this.approvalOptions,
    });

    return {
      ok: false,
      error: "Approval required for this transition",
      errorType: "approval_required",
      approvalId: approvalRequestId,
      approvalFallbackPath: fallbackPath,
    };
  }

  private validateApprovalToken(params: {
    approval: WorkflowApproval;
    approvalRequestId: string;
    approvalToken: string;
  }): TransitionResult<TState> | null {
    const { approval, approvalRequestId, approvalToken } = params;
    const approvalResult = approval.validate({
      requestId: approvalRequestId,
      providedToken: approvalToken,
    });

    if (approvalResult.valid) {
      return null;
    }

    return {
      ok: false,
      error: `Invalid approval: ${approvalResult.reason}`,
      errorType: "approval_invalid",
    };
  }

  private async applyTransition(params: {
    transition: TransitionDefinition<TState, TContext, TParams>;
    triggerParams: TParams;
  }): Promise<TransitionResult<TState>> {
    const { transition, triggerParams } = params;
    const previousState = this.currentState;
    try {
      const { nextState } = await transition.action(
        this.contextValue,
        triggerParams
      );

      if (!this.definition.states.includes(nextState)) {
        return {
          ok: false,
          error: `Action returned invalid state "${nextState}"`,
          errorType: "action_failed",
        };
      }

      this.recordTransitionTo(nextState);

      return {
        ok: true,
        from: previousState,
        to: nextState,
      };
    } catch (error) {
      return {
        ok: false,
        error: getErrorMessage(error),
        errorType: "action_failed",
      };
    }
  }

  private recordTransitionTo(nextState: TState): void {
    this.currentState = nextState;
    if (!this.visited.includes(nextState)) {
      this.visited.push(nextState);
    }
    this.updatedAt = new Date().toISOString();
  }
}

/**
 * Create a workflow instance
 *
 * @param params.definition - The workflow definition created by defineWorkflow
 * @param params.initialContext - Initial context data for the workflow
 * @param params.options - Optional configuration for the instance
 * @param params.options.instanceId - Custom instance ID (default: auto-generated)
 * @param params.options.persistDir - Directory for saving state (default: system temp)
 * @param params.options.approvalOptions - Options for approval requests
 * @param params.options.approval - Approval flow for `requiresApproval` transitions
 * @returns A workflow instance with trigger, canTrigger, serialize, and save methods
 */
export function createWorkflowInstance<
  TState extends string,
  TContext,
  TParams,
>(params: {
  definition: WorkflowDefinition<TState, TContext, TParams>;
  initialContext: TContext;
  options?: WorkflowInstanceOptions<TState>;
}): WorkflowInstance<TState, TContext, TParams> {
  const { definition, initialContext, options = {} } = params;
  return new WorkflowInstanceImpl({ definition, initialContext, options });
}

/** The failure half of `LoadWorkflowResult`, which every read step can return. */
type LoadFailure = Extract<
  LoadWorkflowResult<string, unknown, unknown>,
  { ok: false }
>;

type ReadSavedState =
  | { ok: true; saved: SerializedWorkflowState<string, unknown> }
  | LoadFailure;

async function readStateFileText(
  filePath: string
): Promise<{ ok: true; text: string } | LoadFailure> {
  try {
    return { ok: true, text: await fs.readFile(filePath, "utf-8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error: `File not found: ${filePath}`,
        errorType: "file_not_found",
      };
    }
    return {
      ok: false,
      error: `Failed to read file: ${(err as Error).message}`,
      errorType: "read_error",
    };
  }
}

function parseStateFileText(text: string): ReadSavedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse JSON: ${(err as Error).message}`,
      errorType: "parse_error",
    };
  }

  if (!isSerializedWorkflowState(parsed)) {
    return {
      ok: false,
      error: "Invalid workflow state structure",
      errorType: "parse_error",
    };
  }

  return { ok: true, saved: parsed };
}

/**
 * Every way a persisted state can be unusable, already phrased in the
 * vocabulary `LoadWorkflowResult` has, so the caller is left with the one
 * question that is really its own: whether the state belongs to its workflow.
 */
async function readSavedState(filePath: string): Promise<ReadSavedState> {
  const read = await readStateFileText(filePath);
  if (!read.ok) {
    return read;
  }
  return parseStateFileText(read.text);
}

/**
 * Load a workflow instance from a file
 *
 * @param params.definition - The workflow definition to validate against
 * @param params.filePath - Path to the saved workflow state file
 * @param params.options - Optional configuration for the restored instance
 * @returns Result object with either the loaded instance or error details
 */
export async function loadWorkflowInstance<
  TState extends string,
  TContext,
  TParams,
>(params: {
  definition: WorkflowDefinition<TState, TContext, TParams>;
  filePath: string;
  options?: WorkflowInstanceOptions<TState>;
}): Promise<LoadWorkflowResult<TState, TContext, TParams>> {
  const { definition, filePath } = params;

  const state = await readSavedState(filePath);
  if (!state.ok) {
    return state;
  }

  const saved = state.saved as SerializedWorkflowState<TState, TContext>;

  // Validate workflow ID
  if (saved.workflowId !== definition.id) {
    return {
      ok: false,
      error: `Workflow ID mismatch: expected "${definition.id}", got "${saved.workflowId}"`,
      errorType: "workflow_mismatch",
    };
  }

  // Create instance with restored state
  const instance = createWorkflowInstance({
    definition,
    initialContext: saved.context,
    options: {
      ...params.options,
      instanceId: saved.instanceId,
      restoredState: saved.currentState,
      restoredVisitedStates: saved.visitedStates,
      restoredCreatedAt: saved.createdAt,
      restoredUpdatedAt: saved.updatedAt,
    },
  });

  return { ok: true, instance };
}
