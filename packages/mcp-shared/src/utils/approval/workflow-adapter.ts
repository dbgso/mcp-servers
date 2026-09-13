/**
 * The token flow, as the workflow engine's `WorkflowApproval`.
 *
 * The engine takes this rather than importing the token flow itself, so that
 * importing `mcp-shared/workflow` does not pull `node-notifier` in behind it.
 * Wiring it up is what opts a workflow into notifications:
 *
 * ```ts
 * import { tokenWorkflowApproval } from "mcp-shared/approval";
 * createWorkflowInstance({ definition, options: { approval: tokenWorkflowApproval } });
 * ```
 */

import { requestApproval, validateApproval } from "./core.js";
import type { WorkflowApproval } from "../../types/workflow.js";

export const tokenWorkflowApproval: WorkflowApproval = {
  async request(params) {
    const { fallbackPath } = await requestApproval({
      request: params.request,
      ...(params.options === undefined ? {} : { options: params.options }),
    });
    return { fallbackPath };
  },
  validate(params) {
    return validateApproval(params);
  },
};
