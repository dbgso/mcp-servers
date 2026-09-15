/**
 * What happens to a pending approval over time, and the paths nothing reached.
 *
 * `core.ts` was the least-covered file in the package (77% statements, 78%
 * branches), and the untested parts were the ones that decide whether an
 * approval is still an approval: expiry, cancellation, resend, and the
 * fallback file. The token itself is covered elsewhere; this is about the
 * bookkeeping around it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const notifyMock = vi.fn();

vi.mock("node-notifier", () => ({
  default: {
    get notify() {
      return notifyMock;
    },
  },
}));

const {
  requestApproval,
  validateApproval,
  clearApproval,
  hasPendingApproval,
  resendApprovalNotification,
  getApprovalRejectionMessage,
  getApprovalRequestedMessage,
  buildFallbackFileContent,
} = await import("../utils/approval/core.js");

/** Present this process as a normal (non-test) run. */
function stubProductionEnv(): void {
  vi.stubEnv("VITEST", undefined);
  vi.stubEnv("NODE_ENV", "production");
}

let approvalDir: string;

beforeEach(async () => {
  notifyMock.mockReset();
  notifyMock.mockImplementation(() => undefined);
  approvalDir = await fs.mkdtemp(path.join(os.tmpdir(), "approval-lifecycle-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await fs.rm(approvalDir, { recursive: true, force: true });
});

describe("expiry", () => {
  it("makes a pending approval stop existing", async () => {
    const id = "expiry::pending";
    await requestApproval({ request: { id, operation: "op", description: "d" }, options: { timeoutMs: 50 } });

    expect(hasPendingApproval(id)).toBe(true);
    await new Promise((r) => setTimeout(r, 60));

    expect(hasPendingApproval(id)).toBe(false);
  });

  it("rejects a token that was right when it was issued", async () => {
    const id = "expiry::validate";
    const { token } = await requestApproval({
      request: { id, operation: "op", description: "d" },
      options: { timeoutMs: 50 },
    });
    await new Promise((r) => setTimeout(r, 60));

    expect(validateApproval({ requestId: id, providedToken: token })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("drops the record, so the second attempt reads as not_found", async () => {
    // The distinction matters to a caller deciding whether to ask again: an
    // expired approval can be re-requested, and one that never existed is a
    // bug in the caller.
    const id = "expiry::twice";
    const { token } = await requestApproval({
      request: { id, operation: "op", description: "d" },
      options: { timeoutMs: 50 },
    });
    await new Promise((r) => setTimeout(r, 60));

    expect(validateApproval({ requestId: id, providedToken: token }).reason).toBe("expired");
    expect(validateApproval({ requestId: id, providedToken: token }).reason).toBe("not_found");
  });

  it("is what `resend` reports on, rather than sending into the void", async () => {
    const id = "expiry::resend";
    await requestApproval({ request: { id, operation: "op", description: "d" }, options: { timeoutMs: 50 } });
    await new Promise((r) => setTimeout(r, 60));

    expect(resendApprovalNotification(id)).toBe(false);
  });
});

describe("resendApprovalNotification", () => {
  it("returns false for a request nobody made", () => {
    expect(resendApprovalNotification("resend::absent")).toBe(false);
  });

  it("returns true while the approval is live", async () => {
    const id = "resend::live";
    await requestApproval({ request: { id, operation: "op", description: "d" } });

    expect(resendApprovalNotification(id)).toBe(true);
  });

  it("sends the token again outside a test run", async () => {
    // The token rides the notification and nothing else, so a resend has to
    // carry it -- the fallback file never does.
    const id = "resend::notifies";
    stubProductionEnv();
    const { token } = await requestApproval({
      request: { id, operation: "Promote", description: "a draft" },
      options: { approvalDir },
    });
    notifyMock.mockClear();

    expect(resendApprovalNotification(id)).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].message).toContain(token);
  });

  it("sends nothing under a test run", async () => {
    const id = "resend::quiet";
    await requestApproval({ request: { id, operation: "op", description: "d" } });
    notifyMock.mockClear();

    expect(resendApprovalNotification(id)).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("clearApproval", () => {
  it("cancels a pending approval", async () => {
    const id = "clear::pending";
    const { token } = await requestApproval({ request: { id, operation: "op", description: "d" } });

    clearApproval(id);

    expect(hasPendingApproval(id)).toBe(false);
    expect(validateApproval({ requestId: id, providedToken: token }).reason).toBe("not_found");
  });

  it("is silent about a request that was never there", () => {
    expect(() => clearApproval("clear::absent")).not.toThrow();
  });
});

describe("the fallback file", () => {
  it("is written outside a test run, and never carries the token", async () => {
    // Anything that can read the filesystem can read this file, including the
    // agent whose request is being gated. It records that an approval is
    // pending and nothing more.
    stubProductionEnv();
    const { token, fallbackPath } = await requestApproval({
      request: { id: "file::written", operation: "Promote", description: "a draft" },
      options: { approvalDir },
    });

    const written = await fs.readFile(fallbackPath, "utf-8");
    expect(written).toContain("Promote");
    expect(written).not.toContain(token);
  });

  it("is not written under a test run", async () => {
    const { fallbackPath } = await requestApproval({
      request: { id: "file::skipped", operation: "op", description: "d" },
      options: { approvalDir },
    });

    await expect(fs.access(fallbackPath)).rejects.toThrow();
  });

  it("is not written when the caller says not to", async () => {
    stubProductionEnv();
    const { fallbackPath } = await requestApproval({
      request: { id: "file::opted-out", operation: "op", description: "d" },
      options: { approvalDir, skipFile: true },
    });

    await expect(fs.access(fallbackPath)).rejects.toThrow();
  });

  it("names the operation and when the approval runs out", () => {
    const content = buildFallbackFileContent({
      request: { id: "r", operation: "Delete document", description: "removes a.md" },
      expiresAt: Date.now() + 60_000,
    });

    expect(content).toContain("Delete document");
    expect(content).toContain("removes a.md");
  });
});

describe("the messages a caller relays", () => {
  it("asks for the token without saying how to get around it", () => {
    const message = getApprovalRejectionMessage();

    expect(message).toContain("Approval Required");
    // Nothing in here should hint at the fallback file or the environment
    // override: the caller reading it is the one being gated.
    expect(message).not.toContain("MCP_APPROVAL_TEST_TOKEN");
    expect(message).not.toContain("pending.txt");
  });

  it("says the notification was sent when it was", () => {
    expect(getApprovalRequestedMessage({ delivery: "sent" })).toContain("has been sent");
  });

  it("says approval is impossible when delivery failed, and names the reason", () => {
    const message = getApprovalRequestedMessage({
      delivery: "failed",
      notifyError: "no D-Bus session",
    });

    expect(message).toContain("Could Not Be Requested");
    expect(message).toContain("no D-Bus session");
    expect(message).toContain("Do NOT try to recover the token");
  });

  it("does not claim a failure it cannot describe", () => {
    const message = getApprovalRequestedMessage({ delivery: "failed" });

    expect(message).toContain("Could Not Be Requested");
    expect(message).not.toContain("undefined");
  });

  it("treats a skipped notification as ordinary, not as a failure", () => {
    // "skipped" is a test run or a caller that turned notifications off.
    // Telling that caller approval is impossible would be wrong.
    expect(getApprovalRequestedMessage({ delivery: "skipped" })).toContain("has been sent");
    expect(getApprovalRequestedMessage()).toContain("has been sent");
  });
});

describe("delivery reporting", () => {
  it("reports a notifier error as failed, with its message", async () => {
    stubProductionEnv();
    notifyMock.mockImplementation((_opts: unknown, cb: (e: Error) => void) => {
      cb(new Error("no notification daemon"));
    });

    const result = await requestApproval({
      request: { id: "delivery::failed", operation: "op", description: "d" },
      options: { approvalDir },
    });

    expect(result.delivery).toBe("failed");
    expect(result.notifyError).toContain("no notification daemon");
  });

  it("reports a throw from the notifier as failed too", async () => {
    stubProductionEnv();
    notifyMock.mockImplementation(() => {
      throw new Error("notifier binary missing");
    });

    const result = await requestApproval({
      request: { id: "delivery::threw", operation: "op", description: "d" },
      options: { approvalDir },
    });

    expect(result.delivery).toBe("failed");
    expect(result.notifyError).toContain("notifier binary missing");
  });

  it("settles once, even if the notifier calls back after the grace period", async () => {
    // The callback firing late must not overwrite the delivery already
    // reported, or a resolved promise would be resolved a second time.
    stubProductionEnv();
    let late: ((e: Error) => void) | undefined;
    notifyMock.mockImplementation((_opts: unknown, cb: (e: Error) => void) => {
      late = cb;
    });

    const result = await requestApproval({
      request: { id: "delivery::late", operation: "op", description: "d" },
      options: { approvalDir },
    });

    expect(result.delivery).toBe("sent");
    expect(() => late?.(new Error("too late"))).not.toThrow();
  });
});
