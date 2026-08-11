/**
 * Approval flow -- `mcp-shared/approval`.
 *
 * Kept off the root barrel so a server that never gates anything on approval
 * does not carry the notifier or the review server. An op that does gate holds
 * the strategy instance directly, so importing it is what makes it available --
 * there is no registry, and nothing to register.
 */
export {
  requestApproval,
  validateApproval,
  clearApproval,
  resendApprovalNotification,
  getApprovalRejectionMessage,
  getApprovalRequestedMessage,
  contentHash,
  buildFallbackFileContent,
  hasPendingApproval,
} from "./utils/approval/core.js";

export type {
  ApprovalRequest,
  ApprovalOptions,
  ApprovalResult,
  PendingApproval,
} from "./utils/approval/core.js";

export { TokenApprovalStrategy } from "./utils/approval/token.js";
export type { TokenApprovalConfig } from "./utils/approval/token.js";

export type {
  ApprovalStrategy,
  ApprovalPresentResult,
} from "./utils/approval/strategy.js";

export {
  HtmlApprovalStrategy,
  registerHtmlApproval,
  processHtmlApproval,
  renderApprovalPage,
  splitHunks,
  ensureHtmlServer,
  stopHtmlServer,
} from "./utils/approval/html.js";

export type { HtmlSubmission, HtmlSubmissionResult } from "./utils/approval/html.js";
