// Core surface. duckdb, approval and tunnel helpers are not re-exported here --
// they live behind `mcp-shared/duckdb`, `mcp-shared/approval` and
// `mcp-shared/tunnel`; workflow behind `mcp-shared/workflow`.
//
// A core-only consumer reaches zod and zod-to-json-schema and nothing else --
// no `@duckdb/node-api`, no `node-notifier`, no loopback HTTP server. Keep it
// that way: an import added here is paid for by every server in the repo.
//
// `tools/index.js` does reach `utils/approval/registry.js`, but that module
// imports no strategy, so the approval flow itself stays out of reach. The gate
// it powers is only armed by importing `mcp-shared/approval`.

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

// Error utilities
export {
  getErrorMessage,
  wrapError,
} from "./utils/error.js";

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

// Tool abstractions
export type {
  ToolHandler,
  ToolResponse,
  ToolDefinition,
  ZodLikeSchema,
  RegistrableActionHandler,
  TextContent,
  ImageContent,
  ToolContent,
} from "./tools/index.js";

export {
  BaseToolHandler,
  ToolRegistry,
  BaseActionHandler,
  ActionRegistry,
} from "./tools/index.js";

// Operation pattern (describe/execute MCP tool pair backed by an OperationRegistry)
export type { Operation, CreateDescribeExecuteOptions } from "./tools/index.js";
export {
  OperationRegistry,
  createOperationRegistry,
  createDescribeExecuteHandlers,
} from "./tools/index.js";
