import notifier from "node-notifier";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { contentHash } from "../content-hash.js";
import { getErrorMessage } from "../error.js";

export { contentHash };

// Default paths
const DEFAULT_APPROVAL_DIR = path.join(os.tmpdir(), "mcp-approval");
const DEFAULT_APPROVAL_FILE = "pending.txt";

export interface ApprovalRequest {
  id: string;
  operation: string;
  description: string;
  /**
   * Ground-truth of what will change, computed by the tool itself (e.g. a real
   * diff / dry-run), NOT an AI-authored summary. When provided, the approval is
   * content-bound: `validateApproval` requires the same `what` at execution
   * time, so an approved change cannot be swapped for a different one.
   */
  what?: string;
  /** Human-facing reason the change is needed. Supplied by the caller (AI). */
  why?: string;
}

export interface ApprovalOptions {
  /** Timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Directory for fallback file (default: ~/.mcp-approval) */
  approvalDir?: string;
  /** Whether to show desktop notification (default: true) */
  notify?: boolean;
  /** Skip file creation (for testing, default: false) */
  skipFile?: boolean;
  /**
   * Number of digits in the default numeric token (default: 4). The simple knob
   * for a longer code. Ignored when `tokenGenerator` is supplied. Higher layers
   * (e.g. TokenApprovalStrategy) surface this at construction time; here it is
   * just generation config for the primitive.
   */
  tokenLength?: number;
  /**
   * Full override of token generation. Defaults to a `tokenLength`-digit number —
   * easy for a human to read from a notification and re-type. Consumers that want
   * a different shape (alphanumeric, checksummed) pass their own; the gate does
   * not mandate one shape because that trade-off is the deploying tool's call.
   */
  tokenGenerator?: () => string;
}

export interface PendingApproval {
  token: string;
  request: ApprovalRequest;
  createdAt: number;
  expiresAt: number;
  fallbackPath: string;
  /** sha256 of request.what, set only when `what` was supplied (content-bound approvals). */
  contentHash?: string;
}

export interface ApprovalResult {
  valid: boolean;
  reason?:
    | "missing_token"
    | "invalid_token"
    | "expired"
    | "not_found"
    | "content_mismatch";
}

// In-memory store for pending approvals
const pendingApprovals = new Map<string, PendingApproval>();

/**
 * Default token generator: a short, human-readable 4-digit number. This gate
 * protects against a cooperative agent self-approving by accident, not against
 * an adversary brute-forcing an auth secret, so a short token a human can read
 * and type is the right default. Override the count via ApprovalOptions.tokenLength,
 * or the whole scheme via ApprovalOptions.tokenGenerator.
 */
function generateToken(digits = 4): string {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;
  const num = crypto.randomInt(min, max); // e.g. digits=4 -> 1000-9999
  return num.toString();
}

/**
 * Whether this process is a test run. Gates every affordance that would weaken
 * the approval gate: the fallback-file write, the desktop notification, and the
 * fixed-token override.
 */
function isTestEnvironment(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * Default token source. Mints a fresh numeric token, except under a test run,
 * where MCP_APPROVAL_TEST_TOKEN may fix it. The override exists ONLY so that
 * integration tests which drive the server across a process boundary can
 * approve — the token is delivered out-of-band (never on disk), so a black-box
 * test has no other way to learn it.
 *
 * The test-environment check is the point. The variable is readable by anything
 * that can run a shell in this process's environment — including the agent
 * whose request is being gated — so honoring it outside a test would hand that
 * agent every token and defeat the notification-only channel entirely. A
 * leftover export from an integration run must not silently do that.
 * An explicit ApprovalOptions.tokenGenerator still wins over this.
 */
function defaultToken(tokenLength: number): string {
  if (!isTestEnvironment()) return generateToken(tokenLength);
  return process.env.MCP_APPROVAL_TEST_TOKEN || generateToken(tokenLength);
}

/**
 * Whether a live (non-expired) approval is already pending for this request id.
 * Used to make re-presenting idempotent: a caller that polls must not rotate the
 * token or reset an in-progress approval.
 */
export function hasPendingApproval(requestId: string): boolean {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return false;
  if (Date.now() > pending.expiresAt) {
    pendingApprovals.delete(requestId);
    return false;
  }
  return true;
}

/**
 * Build the human-facing fallback file body. Pure function so the invariant
 * "the token is never written to disk" is unit-testable: the token is not even
 * a parameter here, so it cannot leak into the file.
 */
export function buildFallbackFileContent(params: {
  request: ApprovalRequest;
  expiresAt: number;
}): string {
  const { request, expiresAt } = params;
  return `MCP Approval Required
=====================
Operation: ${request.operation}
Description: ${request.description}
Expires: ${new Date(expiresAt).toLocaleTimeString()}
ID: ${request.id}

The approval token was sent via desktop notification only.
`;
}

/**
 * Request approval for an operation.
 * Sends desktop notification and saves to fallback file.
 * Returns a token that the user must provide to confirm.
 */
/**
 * - `sent`: handed to the notifier, which reported no error.
 * - `failed`: the notifier reported an error, so no one has the token.
 * - `skipped`: no attempt was made -- a test run, or `notify: false`.
 */
export type NotificationDelivery = "sent" | "failed" | "skipped";

export interface ApprovalRequestResult {
  token: string;
  fallbackPath: string;
  /**
   * What became of the notification carrying the token.
   *
   * Three states, not a boolean: "nobody got a token" is true both when
   * delivery failed and when notifications were never attempted, but only the
   * first is something to warn about. Collapsing them made every response
   * under a test run announce that approval was impossible.
   */
  delivery: NotificationDelivery;
  /** Why delivery failed, when it did. Only set for "failed". */
  notifyError?: string;
}

export async function requestApproval(params: {
  request: ApprovalRequest;
  options?: ApprovalOptions;
}): Promise<ApprovalRequestResult> {
  const { request, options = {} } = params;
  const {
    timeoutMs = 5 * 60 * 1000, // 5 minutes
    approvalDir = DEFAULT_APPROVAL_DIR,
    notify = true,
    skipFile = false,
    tokenLength = 4,
    tokenGenerator = () => defaultToken(tokenLength),
  } = options;

  const isTestEnv = isTestEnvironment();
  const shouldSkipFile = skipFile || isTestEnv;
  const shouldNotify = notify && !isTestEnv;

  const token = tokenGenerator();
  const now = Date.now();
  const expiresAt = now + timeoutMs;

  // Write to fallback file
  const fallbackPath = path.join(approvalDir, DEFAULT_APPROVAL_FILE);

  // Store pending approval
  const pending: PendingApproval = {
    token,
    request,
    createdAt: now,
    expiresAt,
    fallbackPath,
    contentHash: request.what === undefined ? undefined : contentHash(request.what),
  };
  pendingApprovals.set(request.id, pending);

  // Write file (skip in test environment).
  // SECURITY: the token is NEVER written to disk. The fallback file is readable
  // by any process with filesystem access (including an AI agent's shell), so
  // persisting the token here would let the caller self-approve. The token is
  // delivered only through the desktop notification (an out-of-band human
  // channel). The file just records that an approval is pending.
  if (!shouldSkipFile) {
    await fs.mkdir(approvalDir, { recursive: true });
    const content = buildFallbackFileContent({ request, expiresAt });
    await fs.writeFile(fallbackPath, content, "utf-8");
  }

  // Send desktop notification (skip in test environment).
  // This is the only channel that carries the token.
  const delivery = shouldNotify
    ? await sendApprovalNotification({
        title: `MCP Approval: ${request.operation}`,
        message: `Token: ${token}\n${request.description}`,
      })
    : { delivery: "skipped" as const, error: undefined };

  return { token, fallbackPath, delivery: delivery.delivery, notifyError: delivery.error };
}

/**
 * How long to wait for the notifier to report a delivery failure.
 *
 * `wait: true` means the callback ALSO fires when the human dismisses the
 * notification, which can be minutes away — so the callback cannot simply be
 * awaited. The failures worth reporting (no notifier binary, no D-Bus, a
 * headless or SSH session) arrive immediately, so give them a short grace
 * period and treat silence as delivery.
 */
const NOTIFY_FAILURE_GRACE_MS = 500;

async function sendApprovalNotification(params: {
  title: string;
  message: string;
}): Promise<{ delivery: NotificationDelivery; error?: string }> {
  const { title, message } = params;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: { delivery: NotificationDelivery; error?: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => settle({ delivery: "sent" }), NOTIFY_FAILURE_GRACE_MS);
    // Never hold the process open just to find out a notification succeeded.
    timer.unref?.();

    try {
      notifier.notify({ title, message, sound: true, wait: true }, (err) => {
        if (err) settle({ delivery: "failed", error: getErrorMessage(err) });
      });
    } catch (err) {
      settle({ delivery: "failed", error: getErrorMessage(err) });
    }
  });
}

/**
 * Validate an approval token.
 */
export function validateApproval(params: {
  requestId: string;
  providedToken: string | undefined;
  /**
   * The tool-computed ground-truth at execution time. Required to pass when the
   * approval was requested with `what` (content-bound). If its hash differs from
   * what was approved, validation fails with `content_mismatch` — the approved
   * change was swapped for a different one.
   */
  currentWhat?: string;
}): ApprovalResult {
  const { requestId, providedToken, currentWhat } = params;
  if (!providedToken) {
    return { valid: false, reason: "missing_token" };
  }

  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return { valid: false, reason: "not_found" };
  }

  const now = Date.now();
  if (now > pending.expiresAt) {
    pendingApprovals.delete(requestId);
    return { valid: false, reason: "expired" };
  }

  if (pending.token !== providedToken.trim()) {
    return { valid: false, reason: "invalid_token" };
  }

  // Content-bound approvals: the change executed must be byte-identical to the
  // one that was approved. A missing or divergent `currentWhat` is a mismatch.
  if (pending.contentHash !== undefined) {
    if (currentWhat === undefined || contentHash(currentWhat) !== pending.contentHash) {
      return { valid: false, reason: "content_mismatch" };
    }
  }

  // Valid! Remove from pending
  pendingApprovals.delete(requestId);
  return { valid: true };
}

/**
 * Clear a pending approval (e.g., on cancel)
 */
export function clearApproval(requestId: string): void {
  pendingApprovals.delete(requestId);
}

/**
 * Resend notification for a pending approval
 */
export function resendApprovalNotification(requestId: string): boolean {
  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return false;
  }

  const now = Date.now();
  if (now > pending.expiresAt) {
    pendingApprovals.delete(requestId);
    return false;
  }

  // Skip notification in test environment.
  // Re-deliver the token via the desktop notification only (never the file).
  if (!isTestEnvironment()) {
    // Deliberately not awaited: the caller only needs to know the approval was
    // still live, and a resend is a retry of a channel already reported as
    // failing. Errors are swallowed by design here, not by omission.
    void sendApprovalNotification({
      title: `MCP Approval: ${pending.request.operation}`,
      message: `Token: ${pending.token}\n${pending.request.description}`,
    });
  }

  return true;
}

/**
 * Get the standard rejection message (doesn't reveal how to bypass)
 */
export function getApprovalRejectionMessage(): string {
  return `# Approval Required

This action requires user approval. Please provide the approval token.`;
}

/**
 * Get a message indicating approval was requested
 */
export function getApprovalRequestedMessage(params?: {
  delivery?: NotificationDelivery;
  notifyError?: string;
}): string {
  // Only an actual failure warns. "skipped" means notifications were never
  // attempted -- a test run, or a caller that turned them off -- which is not
  // something to tell the caller approval is impossible over.
  if (params?.delivery === "failed") {
    return `# Approval Could Not Be Requested

The desktop notification failed to send${params.notifyError ? `: ${params.notifyError}` : ""}.

The token is delivered ONLY through that notification, so nobody can read it and
this operation cannot be approved. Do NOT try to recover the token by other
means. Tell the user that desktop notifications are not working in this
environment — a headless or SSH session, or a missing notifier — so they can fix
it or approve the change by hand.`;
  }

  return `# Approval Requested

A desktop notification has been sent to the user with the approval token.

The token is delivered ONLY through that notification — it is not written to
any file. Ask the user to read the notification and provide the token.

If the notification was missed, request it be resent; do not attempt to recover
the token by other means.`;
}
