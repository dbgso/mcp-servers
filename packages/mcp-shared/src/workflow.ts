/**
 * Workflow state machines -- `mcp-shared/workflow`.
 *
 * Off the root barrel because a workflow instance requests and validates
 * approvals, which reaches node-notifier. Only the instruction server runs
 * workflows, so charging every other bin for that dependency was the whole
 * problem this subpath solves.
 */
export {
  defineWorkflow,
  createWorkflowInstance,
  loadWorkflowInstance,
  isSerializedWorkflowState,
  fieldRequired,
  fieldMinLength,
  stateVisited,
  customValidator,
} from "./utils/workflow.js";

export type {
  PreconditionValidator,
  TransitionResult,
  TransitionDefinition,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceOptions,
  SerializedWorkflowState,
  LoadWorkflowResult,
  WorkflowManagerOptions,
  WorkflowStatus,
  TriggerResult,
} from "./utils/workflow.js";

export { WorkflowManager } from "./utils/workflow.js";
