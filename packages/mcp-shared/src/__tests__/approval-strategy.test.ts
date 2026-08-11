import { describe, it, expect } from "vitest";
import { TokenApprovalStrategy } from "../utils/approval/token.js";
import type { ApprovalStrategy } from "../utils/approval/strategy.js";
import { requestApproval, type ApprovalRequest } from "../utils/approval/core.js";

const baseRequest = (id: string, what?: string): ApprovalRequest => ({
  id,
  operation: "write",
  description: "d",
  what,
});

describe("TokenApprovalStrategy", () => {
  it("present() fires a request and returns the requestId + a no-file message", async () => {
    const s = new TokenApprovalStrategy();
    const { requestId, message } = await s.present(baseRequest("ts-present"));
    expect(requestId).toBe("ts-present");
    // Must not tell the caller to recover the token from a file.
    expect(message).not.toMatch(/check:.*pending/i);
    expect(message).toMatch(/notification/i);
  });

  it("validate() succeeds with the real token and matching content", async () => {
    const s = new TokenApprovalStrategy();
    const what = "diff-A";
    // Acquire a real token via the low-level API (present() hides it by design).
    const { token } = await requestApproval({ request: baseRequest("ts-match", what) });
    const ok = await s.validate({ requestId: "ts-match", providedToken: token, currentWhat: what });
    expect(ok).toEqual({ valid: true });
  });

  it("validate() rejects a swapped change with content_mismatch", async () => {
    const s = new TokenApprovalStrategy();
    const { token } = await requestApproval({ request: baseRequest("ts-swap", "diff-A") });
    const res = await s.validate({
      requestId: "ts-swap",
      providedToken: token,
      currentWhat: "diff-B",
    });
    expect(res).toEqual({ valid: false, reason: "content_mismatch" });
  });

  it("validate() rejects a wrong token before checking content", async () => {
    const s = new TokenApprovalStrategy();
    const { requestId } = await s.present(baseRequest("ts-wrong", "diff-A"));
    const res = await s.validate({ requestId, providedToken: "0000", currentWhat: "diff-A" });
    expect(res).toEqual({ valid: false, reason: "invalid_token" });
  });

  it("threads the constructor's tokenGenerator through present() to validate()", async () => {
    // The generation config lives on the instance (constructor), not on the
    // validate() call. Proof it flows end-to-end: present() mints the token via
    // the supplied generator, so validate() accepts exactly that token.
    const s = new TokenApprovalStrategy({ tokenGenerator: () => "CTOR-9" });
    const { requestId } = await s.present(baseRequest("ts-ctor-gen", "diff-A"));
    const ok = await s.validate({ requestId, providedToken: "CTOR-9", currentWhat: "diff-A" });
    expect(ok).toEqual({ valid: true });
  });
});

describe("an operation holds its strategy directly", () => {
  // What a registry used to provide -- swapping in a configured or custom
  // strategy -- is now just the value on the op. No global state, no ordering,
  // and no way to name one that was never imported.
  it("takes a configured built-in", async () => {
    const op = { approval: new TokenApprovalStrategy({ tokenGenerator: () => "CFG-6" }) };

    const { requestId } = await op.approval.present(baseRequest("ts-configured", "diff-A"));
    const ok = await op.approval.validate({
      requestId,
      providedToken: "CFG-6",
      currentWhat: "diff-A",
    });

    expect(ok).toEqual({ valid: true });
  });

  it("takes a strategy this package never defined", async () => {
    const custom: ApprovalStrategy = {
      kind: "custom",
      present: async (r) => ({ requestId: r.id, message: "approve out of band" }),
      validate: () => ({ valid: true }),
    };
    const op = { approval: custom };

    expect(op.approval.kind).toBe("custom");
    expect(await op.approval.validate({ requestId: "x", currentWhat: "d" })).toEqual({
      valid: true,
    });
  });
});
