import { errorResponse, getErrorMessage, type ToolResponse } from "mcp-shared";
import type { WatchManager } from "../watch/manager.js";

/** Shared context handed to every operation: the process-wide watch manager. */
export interface WaitContext {
  manager: WatchManager;
}

/** Turn an expected failure (unknown source, bad config, unknown id) into an error response. */
export async function guarded(run: () => Promise<ToolResponse>): Promise<ToolResponse> {
  try {
    return await run();
  } catch (error) {
    return errorResponse(getErrorMessage(error));
  }
}
