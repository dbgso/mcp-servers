/**
 * The token flow as the workflow engine's `WorkflowApproval`.
 *
 * Added when the engine stopped importing the token flow directly, and added
 * without a test -- coverage put it at 0%, which is how it was found. What
 * matters about it is thin but load-bearing: it must pass the caller's options
 * through, and it must not invent an `options` key when there are none, since
 * `requestApproval` reads its own defaults from the absence.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import * as core from "../utils/approval/core.js";
import { tokenWorkflowApproval } from "../utils/approval/workflow-adapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokenWorkflowApproval", () => {
  const request = { id: "workflow::promote", operation: "Promote", description: "a draft" };

  it("requests through the token flow and returns the fallback path", async () => {
    const spy = vi
      .spyOn(core, "requestApproval")
      .mockResolvedValue({ token: "1234", fallbackPath: "/tmp/pending.txt", delivery: "skipped" });

    const result = await tokenWorkflowApproval.request({ request });

    expect(result).toEqual({ fallbackPath: "/tmp/pending.txt" });
    expect(spy).toHaveBeenCalledWith({ request });
  });

  it("does not pass an options key when the caller gave none", async () => {
    // `requestApproval` defaults its own options. Passing `options: undefined`
    // is not the same as not passing it for a caller that spreads it.
    const spy = vi
      .spyOn(core, "requestApproval")
      .mockResolvedValue({ token: "1", fallbackPath: "/tmp/p", delivery: "skipped" });

    await tokenWorkflowApproval.request({ request });

    expect(Object.keys(spy.mock.calls[0][0])).toEqual(["request"]);
  });

  it("threads the caller's options through", async () => {
    const spy = vi
      .spyOn(core, "requestApproval")
      .mockResolvedValue({ token: "1", fallbackPath: "/tmp/p", delivery: "skipped" });
    const options = { notify: false, timeoutMs: 1000 };

    await tokenWorkflowApproval.request({ request, options });

    expect(spy).toHaveBeenCalledWith({ request, options });
  });

  it("validates through the token flow, passing the arguments unchanged", () => {
    const spy = vi.spyOn(core, "validateApproval").mockReturnValue({ valid: true });

    const result = tokenWorkflowApproval.validate({ requestId: "r", providedToken: "1234" });

    expect(result).toEqual({ valid: true });
    expect(spy).toHaveBeenCalledWith({ requestId: "r", providedToken: "1234" });
  });

  it("returns a rejection as it came back", () => {
    vi.spyOn(core, "validateApproval").mockReturnValue({ valid: false, reason: "expired" });

    expect(tokenWorkflowApproval.validate({ requestId: "r", providedToken: "x" })).toEqual({
      valid: false,
      reason: "expired",
    });
  });
});
