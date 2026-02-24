import type { ToolResponse } from "../types.js";

/**
 * Context passed to all ts_ast action handlers.
 * Currently empty - handlers manage their own resources.
 */
export interface TsAstActionContext {
  // Future: shared project instance, caching, etc.
}

/**
 * Interface for ts_ast action handlers.
 */
export interface TsAstActionHandler {
  readonly action: string;
  readonly help: string;
  execute(params: { rawParams: unknown; context: TsAstActionContext }): Promise<ToolResponse>;
}
