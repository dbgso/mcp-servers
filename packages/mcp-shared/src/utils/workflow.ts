/**
 * Workflow State Machine Library
 *
 * A lightweight state machine for MCP tools with:
 * - Declarative workflow definitions
 * - Precondition validators (Strategy pattern)
 * - Approval integration
 * - File-based persistence
 */

import type { WorkflowDefinition } from "../types/workflow.js";

// Re-export types
export type {
  PreconditionValidator,
  TransitionResult,
  TransitionDefinition,
  WorkflowDefinition,
  SerializedWorkflowState,
  LoadWorkflowResult,
  WorkflowInstance,
  WorkflowInstanceOptions,
} from "../types/workflow.js";

// Re-export type guard
export { isSerializedWorkflowState } from "../types/workflow.js";

// Re-export validators
export {
  fieldRequired,
  fieldMinLength,
  stateVisited,
  customValidator,
} from "../workflow/validators.js";

// Re-export instance functions
export {
  createWorkflowInstance,
  loadWorkflowInstance,
  workflowStateFileName,
  instanceIdFromStateFileName,
} from "../workflow/instance.js";

// Re-export manager
export { WorkflowManager } from "../workflow/manager.js";
export type {
  WorkflowManagerOptions,
  WorkflowStatus,
  TriggerResult,
} from "../workflow/manager.js";

/**
 * Create a workflow definition
 */
export function defineWorkflow<TState extends string, TContext, TParams>(
  definition: WorkflowDefinition<TState, TContext, TParams>
): WorkflowDefinition<TState, TContext, TParams> {
  // Validate definition
  if (!definition.states.includes(definition.initial)) {
    throw new Error(
      `Initial state "${definition.initial}" is not in states list`
    );
  }

  // Flattened rather than nested: the transitions are only visited to find the
  // first `from` that was never declared, and `find` says that in one place.
  const undeclaredFrom = definition.transitions
    .flatMap((transition) => transition.from)
    .find((state) => !definition.states.includes(state));
  if (undeclaredFrom !== undefined) {
    throw new Error(`Transition 'from' state "${undeclaredFrom}" is not in states list`);
  }

  return definition;
}
