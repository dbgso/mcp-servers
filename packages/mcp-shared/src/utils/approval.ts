import notifier from "node-notifier";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Default paths
const DEFAULT_APPROVAL_DIR = path.join(os.tmpdir(), "mcp-approval");
const DEFAULT_APPROVAL_FILE = "pending.txt";

export interface ApprovalRequest {
  id: string;
  operation: string;
  description: string;
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
}

export interface PendingApproval {
  token: string;
  request: ApprovalRequest;
  createdAt: number;
  expiresAt: number;
  fallbackPath: string;
}

export interface ApprovalResult {
  valid: boolean;
  reason?: "missing_token" | "invalid_token" | "expired" | "not_found";
}

// In-memory store for pending approvals
const pendingApprovals = new Map<string, PendingApproval>();

/**
 * Generate a short, human-readable token (4-digit number)
 */
function generateToken(): string {
  const num = crypto.randomInt(1000, 10000); // 1000-9999
  return num.toString();
}

/**
 * Request approval for an operation.
 * Sends desktop notification and saves to fallback file.
 * Returns a token that the user must provide to confirm.
 */
export async function requestApproval(params: {
  request: ApprovalRequest;
  options?: ApprovalOptions;
}): Promise<{ token: string; fallbackPath: string }> {
  const { request, options = {} } = params;
  const {
    timeoutMs = 5 * 60 * 1000, // 5 minutes
    approvalDir = DEFAULT_APPROVAL_DIR,
    notify = true,
    skipFile = false,
  } = options;

  // Check for test environment
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  const shouldSkipFile = skipFile || isTestEnv;
  const shouldNotify = notify && !isTestEnv;

  const token = generateToken();
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
  };
  pendingApprovals.set(request.id, pending);

  // Write file (skip in test environment)
  if (!shouldSkipFile) {
    await fs.mkdir(approvalDir, { recursive: true });
    const content = `MCP Approval Required
=====================
Operation: ${request.operation}
Description: ${request.description}
Token: ${token}
Expires: ${new Date(expiresAt).toLocaleTimeString()}
ID: ${request.id}
`;
    await fs.writeFile(fallbackPath, content, "utf-8");
  }

  // Send desktop notification (skip in test environment)
  if (shouldNotify) {
    notifier.notify({
      title: `MCP Approval: ${request.operation}`,
      message: `Token: ${token}\n${request.description}\nFile: ${fallbackPath}`,
      sound: true,
      wait: true,
    });
  }

  return { token, fallbackPath };
}

/**
 * Validate an approval token.
 */
export function validateApproval(params: {
  requestId: string;
  providedToken: string | undefined;
}): ApprovalResult {
  const { requestId, providedToken } = params;
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

  // Skip notification in test environment
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (!isTestEnv) {
    notifier.notify({
      title: `MCP Approval: ${pending.request.operation}`,
      message: `Token: ${pending.token}\n${pending.request.description}\nFile: ${pending.fallbackPath}`,
      sound: true,
      wait: true,
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
export function getApprovalRequestedMessage(fallbackPath: string): string {
  return `# Approval Requested

A desktop notification has been sent with the approval token.

If you missed the notification, check: ${fallbackPath}

Provide the token to proceed.`;
}
