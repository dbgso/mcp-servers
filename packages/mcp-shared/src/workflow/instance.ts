/**
 * Workflow Instance Management
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  requestApproval,
  validateApproval,
  type ApprovalRequest,
} from "../utils/approval.js";
import {
  isSerializedWorkflowState,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowInstanceOptions,
  type TransitionDefinition,
  type TransitionResult,
  type SerializedWorkflowState,
  type LoadWorkflowResult,
  type ContextWithVisitedStates,
} from "../types/workflow.js";
import { getErrorMessage } from "../utils/error.js";

const DEFAULT_PERSIST_DIR = path.join(os.tmpdir(), "mcp-workflow");

/**
 * Create a workflow instance
 *
 * @param params.definition - The workflow definition created by defineWorkflow
 * @param params.initialContext - Initial context data for the workflow
 * @param params.options - Optional configuration for the instance
 * @param params.options.instanceId - Custom instance ID (default: auto-generated)
 * @param params.options.persistDir - Directory for saving state (default: system temp)
 * @param params.options.approvalOptions - Options for approval requests
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
  const {
    instanceId = `${definition.id}-${Date.now()}`,
    persistDir = DEFAULT_PERSIST_DIR,
    approvalOptions,
    restoredState,
    restoredVisitedStates,
    restoredCreatedAt,
    restoredUpdatedAt,
  } = options;

  // Use restored state if provided, otherwise use initial state
  let currentState: TState = restoredState ?? definition.initial;
  const context: TContext = { ...initialContext };
  const visitedStates: TState[] = restoredVisitedStates
    ? [...restoredVisitedStates]
    : [definition.initial];
  const createdAt = restoredCreatedAt ?? new Date().toISOString();
  let updatedAt = restoredUpdatedAt ?? createdAt;

  /**
   * Find the first transition that matches the current state
   */
  function findTransition(): TransitionDefinition<TState, TContext, TParams> | undefined {
    return definition.transitions.find((t) => t.from.includes(currentState));
  }

  /**
   * Check if all preconditions are satisfied for a transition
   */
  function checkPreconditions(args: {
    transition: TransitionDefinition<TState, TContext, TParams>;
    triggerParams: TParams;
  }): { valid: boolean; failedMessage?: string } {
    const { transition, triggerParams } = args;
    if (!transition.preconditions) {
      return { valid: true };
    }

    // Inject visited states into context for stateVisited validator
    const ctxWithVisited: ContextWithVisitedStates<TContext> = {
      ...context,
      _visitedStates: visitedStates as string[],
    };

    for (const validator of transition.preconditions) {
      // Validators expecting TContext will work with extended context
      if (!validator.validate(ctxWithVisited, triggerParams)) {
        return { valid: false, failedMessage: validator.getMessage() };
      }
    }

    return { valid: true };
  }

  /**
   * Check if approval is required for a transition
   */
  function isApprovalRequired(args: {
    transition: TransitionDefinition<TState, TContext, TParams>;
    triggerParams: TParams;
  }): boolean {
    const { transition, triggerParams } = args;
    if (typeof transition.requiresApproval === "function") {
      return transition.requiresApproval(triggerParams);
    }
    return transition.requiresApproval === true;
  }

  /**
   * Handle approval flow: request or validate approval token
   * @returns null if approved, TransitionResult if approval needed or invalid
   */
  async function handleApproval(args: {
    approvalToken: string | undefined;
    approvalRequestId: string;
  }): Promise<TransitionResult<TState> | null> {
    const { approvalToken, approvalRequestId } = args;

    if (!approvalToken) {
      // Request approval
      const approvalRequest: ApprovalRequest = {
        id: approvalRequestId,
        operation: `Workflow: ${definition.id}`,
        description: `Transition from "${currentState}"`,
      };

      const { fallbackPath } = await requestApproval({
        request: approvalRequest,
        options: approvalOptions,
      });

      return {
        ok: false,
        error: "Approval required for this transition",
        errorType: "approval_required",
        approvalId: approvalRequestId,
        approvalFallbackPath: fallbackPath,
      };
    }

    // Validate approval token
    const approvalResult = validateApproval({
      requestId: approvalRequestId,
      providedToken: approvalToken,
    });

    if (!approvalResult.valid) {
      return {
        ok: false,
        error: `Invalid approval: ${approvalResult.reason}`,
        errorType: "approval_invalid",
      };
    }

    return null; // Approved
  }

  const instance: WorkflowInstance<TState, TContext, TParams> = {
    get id() {
      return instanceId;
    },
    get workflowId() {
      return definition.id;
    },
    get state() {
      return currentState;
    },
    get context() {
      return { ...context };
    },
    get visitedStates() {
      return [...visitedStates];
    },

    canTrigger(triggerParams: TParams) {
      const transition = findTransition();
      if (!transition) {
        return {
          allowed: false,
          reason: `No transition defined for state "${currentState}"`,
        };
      }

      const preconditionResult = checkPreconditions({ transition, triggerParams });
      if (!preconditionResult.valid) {
        return {
          allowed: false,
          reason: preconditionResult.failedMessage,
        };
      }

      const needsApproval = isApprovalRequired({ transition, triggerParams });
      return {
        allowed: true,
        requiresApproval: needsApproval,
      };
    },

    async trigger(args: {
      params: TParams;
      approvalToken?: string;
    }): Promise<TransitionResult<TState>> {
      const { params: triggerParams, approvalToken } = args;
      const transition = findTransition();
      if (!transition) {
        return {
          ok: false,
          error: `No transition defined for state "${currentState}"`,
          errorType: "no_transition",
        };
      }

      // Check preconditions
      const preconditionResult = checkPreconditions({ transition, triggerParams });
      if (!preconditionResult.valid) {
        return {
          ok: false,
          error: preconditionResult.failedMessage ?? "Precondition failed",
          errorType: "precondition_failed",
        };
      }

      // Check approval if required
      const needsApproval = isApprovalRequired({ transition, triggerParams });
      if (needsApproval) {
        const approvalRequestId = `${instanceId}-${currentState}`;
        const approvalResult = await handleApproval({ approvalToken, approvalRequestId });
        if (approvalResult) {
          return approvalResult;
        }
      }

      // Execute action
      const previousState = currentState;
      try {
        const result = await transition.action(context, triggerParams);
        const nextState = result.nextState;

        // Validate next state
        if (!definition.states.includes(nextState)) {
          return {
            ok: false,
            error: `Action returned invalid state "${nextState}"`,
            errorType: "action_failed",
          };
        }

        // Update state
        currentState = nextState;
        if (!visitedStates.includes(nextState)) {
          visitedStates.push(nextState);
        }
        updatedAt = new Date().toISOString();

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
    },

    serialize(): SerializedWorkflowState<TState, TContext> {
      return {
        workflowId: definition.id,
        instanceId,
        currentState,
        context,
        visitedStates: [...visitedStates],
        createdAt,
        updatedAt,
      };
    },

    async save(filePath?: string): Promise<string> {
      const targetPath =
        filePath ?? path.join(persistDir, `${instanceId}.json`);

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const serialized = instance.serialize();
      await fs.writeFile(targetPath, JSON.stringify(serialized, null, 2), "utf-8");

      return targetPath;
    },
  };

  return instance;
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
  const { definition, filePath, options = {} } = params;

  // Read file
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
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

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse JSON: ${(err as Error).message}`,
      errorType: "parse_error",
    };
  }

  // Validate structure
  if (!isSerializedWorkflowState(parsed)) {
    return {
      ok: false,
      error: "Invalid workflow state structure",
      errorType: "parse_error",
    };
  }

  const saved = parsed as SerializedWorkflowState<TState, TContext>;

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
      ...options,
      instanceId: saved.instanceId,
      restoredState: saved.currentState,
      restoredVisitedStates: saved.visitedStates,
      restoredCreatedAt: saved.createdAt,
      restoredUpdatedAt: saved.updatedAt,
    },
  });

  return { ok: true, instance };
}
