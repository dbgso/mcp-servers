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

// Elicitation utilities
export {
  requestConfirmation,
  confirm,
  isElicitationAvailable,
} from "./utils/elicitation.js";

export type {
  ElicitationResult,
  ConfirmationOptions,
} from "./utils/elicitation.js";

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
