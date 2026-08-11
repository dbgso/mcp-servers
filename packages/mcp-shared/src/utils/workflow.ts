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

  for (const transition of definition.transitions) {
    for (const state of transition.from) {
      if (!definition.states.includes(state)) {
        throw new Error(`Transition 'from' state "${state}" is not in states list`);
      }
    }
  }

  return definition;
}
