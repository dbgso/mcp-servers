/**
 * The two ways the approval gate can quietly stop being a gate:
 *
 * - MCP_APPROVAL_TEST_TOKEN fixing the token outside a test run. The variable
 *   is readable by anything sharing this process's environment, including the
 *   agent whose request is being gated, so honoring it in production would hand
 *   that agent every token.
 * - A notification that never arrives while the caller is told one was sent.
 *   The token rides that channel and nothing else, so a silent delivery failure
 *   makes the operation unapprovable under a message claiming otherwise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const notifyMock = vi.fn();

vi.mock("node-notifier", () => ({
  default: {
    get notify() {
      return notifyMock;
    },
  },
}));

const { requestApproval, getApprovalRequestedMessage } = await import(
  "../utils/approval/core.js"
);

/** Present this process as a normal (non-test) run. */
function stubProductionEnv(): void {
  vi.stubEnv("VITEST", undefined);
  vi.stubEnv("NODE_ENV", "production");
}

beforeEach(() => {
  notifyMock.mockReset();
  // Default: the notifier accepts the message and reports no error.
  notifyMock.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP_APPROVAL_TEST_TOKEN", () => {
  it("fixes the token under a test run", async () => {
    vi.stubEnv("MCP_APPROVAL_TEST_TOKEN", "4321");

    const { token } = await requestApproval({
      request: { id: "env-test-run", operation: "op", description: "d" },
    });

    expect(token).toBe("4321");
  });

  it("is ignored outside a test run", async () => {
    stubProductionEnv();
    vi.stubEnv("MCP_APPROVAL_TEST_TOKEN", "4321");

    const { token } = await requestApproval({
      request: { id: "env-production", operation: "op", description: "d" },
      options: { skipFile: true, notify: false },
    });

    expect(token).not.toBe("4321");
    expect(token).toMatch(/^\d{4}$/);
  });

  it("still lets an explicit tokenGenerator win", async () => {
    vi.stubEnv("MCP_APPROVAL_TEST_TOKEN", "4321");

    const { token } = await requestApproval({
      request: { id: "env-explicit-generator", operation: "op", description: "d" },
      options: { tokenGenerator: () => "9999" },
    });

    expect(token).toBe("9999");
  });
});

describe("notification delivery", () => {
  it("reports a delivery failure instead of claiming the notification was sent", async () => {
    stubProductionEnv();
    notifyMock.mockImplementation((_opts: unknown, cb?: (err: Error | null) => void) => {
      cb?.(new Error("spawn notify-send ENOENT"));
    });

    const result = await requestApproval({
      request: { id: "notify-fails", operation: "op", description: "d" },
      options: { skipFile: true },
    });

    expect(result.delivery).toBe("failed");
    expect(result.notifyError).toContain("ENOENT");

    const message = getApprovalRequestedMessage(result);
    expect(message).toContain("Approval Could Not Be Requested");
    expect(message).toContain("ENOENT");
    // The agent must not be nudged toward recovering the token another way.
    expect(message).toContain("Do NOT try to recover the token by other");
  });

  it("reports a synchronous throw from the notifier the same way", async () => {
    stubProductionEnv();
    notifyMock.mockImplementation(() => {
      throw new Error("no D-Bus session");
    });

    const result = await requestApproval({
      request: { id: "notify-throws", operation: "op", description: "d" },
      options: { skipFile: true },
    });

    expect(result.delivery).toBe("failed");
    expect(result.notifyError).toContain("D-Bus");
  });

  it("treats silence from the notifier as delivered", async () => {
    stubProductionEnv();
    // `wait: true` means a success callback may not arrive until the human
    // dismisses the notification, so no callback within the grace period is
    // the normal success path.
    notifyMock.mockImplementation(() => undefined);

    const result = await requestApproval({
      request: { id: "notify-silent", operation: "op", description: "d" },
      options: { skipFile: true },
    });

    expect(result.delivery).toBe("sent");
    expect(result.notifyError).toBeUndefined();
    expect(getApprovalRequestedMessage(result)).toContain("A desktop notification has been sent");
  });

  it("keeps the old message for a caller that passes nothing", () => {
    expect(getApprovalRequestedMessage()).toContain("A desktop notification has been sent");
  });

  it("does not notify at all under a test run", async () => {
    const result = await requestApproval({
      request: { id: "notify-test-env", operation: "op", description: "d" },
    });

    expect(notifyMock).not.toHaveBeenCalled();
    expect(result.delivery).toBe("skipped");
  });

  // The regression this three-state exists for: a boolean made "never
  // attempted" indistinguishable from "failed", so every approval requested
  // under a test run -- or with notify: false -- came back announcing that the
  // operation could not be approved, directly under the handler's own
  // "# Approval Requested" heading.
  it.each([
    ["a test run", {}],
    ["notify: false", { skipFile: true, notify: false }],
  ])("does not claim failure when notification was merely skipped (%s)", async (_label, options) => {
    const result = await requestApproval({
      request: { id: `skip-${_label}`, operation: "op", description: "d" },
      options,
    });

    expect(result.delivery).toBe("skipped");
    const message = getApprovalRequestedMessage(result);
    expect(message).not.toContain("Could Not Be Requested");
    expect(message).toContain("Approval Requested");
  });
});
