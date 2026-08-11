import {
  requestApproval,
  validateApproval,
  getApprovalRequestedMessage,
  hasPendingApproval,
  type ApprovalRequest,
  type ApprovalResult,
} from "./core.js";
import type { ApprovalStrategy, ApprovalPresentResult } from "./strategy.js";

/**
 * How the token is generated. Per-instance configuration of THIS strategy,
 * chosen when it is constructed — NOT a per-approval or per-validation argument.
 * It lives here, with the implementation it configures, so adding or changing a
 * token option never touches the shared strategy contract.
 */
export interface TokenApprovalConfig {
  /** Digits in the default numeric token (default: 4). Ignored if `tokenGenerator` is set. */
  tokenLength?: number;
  /** Full override of token generation (alphanumeric, checksummed, ...). */
  tokenGenerator?: () => string;
}

/**
 * Token strategy: the token is delivered only via desktop notification (never
 * to disk), the human reads it and relays it back, and validation is
 * content-bound. Lightweight; appropriate for lower-risk mutations.
 */
export class TokenApprovalStrategy implements ApprovalStrategy {
  readonly kind = "token" as const;

  constructor(private readonly config: TokenApprovalConfig = {}) {}

  async present(request: ApprovalRequest): Promise<ApprovalPresentResult> {
    // Idempotent: if an approval for this exact request is already pending,
    // reuse it. Re-issuing would rotate the token and invalidate the one the
    // human already saw, so a caller that polls could never be approved.
    if (!hasPendingApproval(request.id)) {
      // Thread the instance's generation config into the primitive that mints
      // the token. This is the only place the config is consumed.
      await requestApproval({
        request,
        options: {
          tokenLength: this.config.tokenLength,
          tokenGenerator: this.config.tokenGenerator,
        },
      });
    }
    return {
      requestId: request.id,
      message: getApprovalRequestedMessage(),
    };
  }

  validate(params: {
    requestId: string;
    currentWhat?: string;
    providedToken?: string;
  }): ApprovalResult {
    return validateApproval({
      requestId: params.requestId,
      providedToken: params.providedToken,
      currentWhat: params.currentWhat,
    });
  }
}
