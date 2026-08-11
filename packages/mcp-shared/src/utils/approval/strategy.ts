import type { ApprovalRequest, ApprovalResult } from "./core.js";

/**
 * The approval-strategy CONTRACT — types only, no runtime code.
 *
 * This file deliberately imports nothing at runtime (only `import type`), so a
 * consumer that just wants the interface cannot pull an implementation (and its
 * dependency graph — the HTTP server, the notifier) in behind it. Implementations
 * live in `token.ts` / `html.ts`, `registry.ts` resolves a kind to one, and the
 * `mcp-shared/approval` entry is what installs the built-in ones.
 *
 * The security model does NOT trust a bare approval click: the thing approved
 * is the tool-computed `what` (a real diff), the token/proof lives on a channel
 * the caller cannot read, and approval is content-bound so an approved change
 * cannot be swapped for a different one. Strategies differ only in how the
 * request is presented to the human and how the human's approval is proven.
 */
export interface ApprovalPresentResult {
  /** Correlates the later validate() call with this pending request. */
  requestId: string;
  /** Markdown message returned to the caller explaining how approval is obtained. */
  message: string;
}

export interface ApprovalStrategy {
  /** Identifies the strategy in messages and logs; not used to look it up. */
  readonly kind: string;
  /**
   * First (unapproved) attempt: fire the approval request through this
   * strategy's channel (desktop notification, local HTML screen, ...).
   */
  present(request: ApprovalRequest): Promise<ApprovalPresentResult>;
  /**
   * Second attempt: prove the human approved. Content-bound — `currentWhat` is
   * the ground-truth recomputed at execution time and must match what was
   * approved.
   */
  validate(params: {
    requestId: string;
    currentWhat?: string;
    providedToken?: string;
  }): ApprovalResult | Promise<ApprovalResult>;
}
