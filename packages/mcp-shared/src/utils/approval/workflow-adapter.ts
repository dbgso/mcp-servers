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

import {
  requestApproval,
  validateApproval,
  type ApprovalOptions,
  type ApprovalRequest,
  type ApprovalResult,
} from "./core.js";
import type { WorkflowApproval } from "../../types/workflow.js";

class TokenWorkflowApproval implements WorkflowApproval {
  async request(params: {
    request: ApprovalRequest;
    options?: ApprovalOptions;
  }): Promise<{ fallbackPath: string }> {
    const { fallbackPath } = await requestApproval({
      request: params.request,
      ...(params.options === undefined ? {} : { options: params.options }),
    });
    return { fallbackPath };
  }

  validate(params: { requestId: string; providedToken: string }): ApprovalResult {
    return validateApproval(params);
  }
}

/**
 * There is nothing to configure, so one instance serves every workflow. It stays
 * a value rather than asking each caller to construct it: the wiring above is
 * the whole point, and `new` at every call site would be noise.
 */
export const tokenWorkflowApproval: WorkflowApproval = new TokenWorkflowApproval();
