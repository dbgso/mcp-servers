// Types
export type { ToolHandler, ToolResponse, ToolDefinition, ZodLikeSchema, TextContent, ImageContent, ToolContent } from "./types.js";

// Base class for 1 handler = 1 tool pattern
export { BaseToolHandler } from "./base-handler.js";

// Registry for multiple tools
export { ToolRegistry } from "./registry.js";

// Base class for action dispatch pattern (1 tool + multiple actions)
export { BaseActionHandler } from "./base-action-handler.js";

// Registry for action handlers within a single tool
export { ActionRegistry } from "./action-registry.js";
export type { RegistrableActionHandler } from "./action-registry.js";
