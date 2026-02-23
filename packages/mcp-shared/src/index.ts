// Types
export type {
  ReminderConfig,
  ToolResult,
  ActionHandler,
} from "./types/index.js";

export type {
  DefinitionLocation,
  GoToDefinitionResult,
  ReferenceLocation,
  FindReferencesResult,
} from "./types/definition.js";

export type { FileResult } from "./utils/multi-file.js";

// Utilities
export {
  buildReminderBlock,
  wrapResponse,
} from "./utils/response-wrapper.js";

export {
  errorResponse,
  jsonResponse,
} from "./utils/mcp-response.js";

export {
  processMultipleFiles,
  formatMultiFileResponse,
} from "./utils/multi-file.js";

// Pagination utilities
export {
  encodeCursor,
  decodeCursor,
  paginate,
} from "./utils/pagination.js";

export type {
  PaginationParams,
  PaginatedResponse,
} from "./utils/pagination.js";

// Approval utilities
export {
  requestApproval,
  validateApproval,
  clearApproval,
  resendApprovalNotification,
  getApprovalRejectionMessage,
  getApprovalRequestedMessage,
} from "./utils/approval.js";

export type {
  ApprovalRequest,
  ApprovalOptions,
  ApprovalResult,
  PendingApproval,
} from "./utils/approval.js";

// Diff utilities
export {
  diffStructures,
} from "./utils/diff.js";

export type {
  DiffableItem,
  DiffChange,
  DiffResult,
  DiffOptions,
} from "./utils/diff.js";

// Workflow utilities
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

// Tool abstractions
export type {
  ToolHandler,
  ToolResponse,
  ToolDefinition,
  ZodLikeSchema,
  RegistrableActionHandler,
} from "./tools/index.js";

export {
  BaseToolHandler,
  ToolRegistry,
  BaseActionHandler,
  ActionRegistry,
} from "./tools/index.js";
