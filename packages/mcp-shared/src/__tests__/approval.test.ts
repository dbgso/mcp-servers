import { describe, it, expect } from "vitest";
import {
  requestApproval,
  validateApproval,
  contentHash,
  buildFallbackFileContent,
  type ApprovalRequest,
} from "../utils/approval/core.js";

// In the test environment (VITEST=true) requestApproval skips both the desktop
// notification and the fallback file write, so these tests exercise only the
// in-memory token/content-bind logic with no side effects.

async function requestToken(request: ApprovalRequest): Promise<string> {
  const { token } = await requestApproval({ request });
  return token;
}

describe("contentHash", () => {
  it("is deterministic for identical input", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
  });

  it("differs for different input", () => {
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
});

describe("validateApproval — token checks", () => {
  it.each([
    { name: "missing token", token: undefined, reason: "missing_token" },
    { name: "wrong token", token: "0000", reason: "invalid_token" },
    { name: "unknown request", token: "1234", reason: "not_found", skipRequest: true },
  ])("rejects $name", async ({ token, reason, skipRequest }) => {
    const id = `tok-${reason}`;
    if (!skipRequest) {
      await requestApproval({ request: { id, operation: "op", description: "d" } });
    }
    const result = validateApproval({ requestId: id, providedToken: token });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it("accepts the correct token (no content binding)", async () => {
    const id = "tok-ok";
    const token = await requestToken({ id, operation: "op", description: "d" });
    expect(validateApproval({ requestId: id, providedToken: token })).toEqual({
      valid: true,
    });
  });

  it("consumes the approval on success (single-use)", async () => {
    const id = "tok-single-use";
    const token = await requestToken({ id, operation: "op", description: "d" });
    expect(validateApproval({ requestId: id, providedToken: token }).valid).toBe(true);
    // Second use: the pending entry was deleted.
    expect(validateApproval({ requestId: id, providedToken: token })).toEqual({
      valid: false,
      reason: "not_found",
    });
  });
});

describe("validateApproval — content binding", () => {
  const what = "--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-old\n+new\n";

  it("accepts when the executed `what` matches the approved one", async () => {
    const id = "cb-match";
    const token = await requestToken({ id, operation: "write", description: "d", what });
    expect(
      validateApproval({ requestId: id, providedToken: token, currentWhat: what }),
    ).toEqual({ valid: true });
  });

  it.each([
    { name: "the change was swapped (different what)", currentWhat: `${what}TAMPERED` },
    { name: "no current what is supplied", currentWhat: undefined },
  ])("rejects with content_mismatch when $name", async ({ currentWhat }) => {
    const id = `cb-${currentWhat ? "swap" : "absent"}`;
    const token = await requestToken({ id, operation: "write", description: "d", what });
    const result = validateApproval({ requestId: id, providedToken: token, currentWhat });
    expect(result).toEqual({ valid: false, reason: "content_mismatch" });
  });

  it("does not consume the approval on a content mismatch", async () => {
    const id = "cb-retry";
    const token = await requestToken({ id, operation: "write", description: "d", what });
    // Wrong content first — must not burn the pending approval.
    expect(
      validateApproval({ requestId: id, providedToken: token, currentWhat: "wrong" }).valid,
    ).toBe(false);
    // Correct content afterwards still succeeds.
    expect(
      validateApproval({ requestId: id, providedToken: token, currentWhat: what }).valid,
    ).toBe(true);
  });
});

describe("token generator is parameterizable (default 4-digit)", () => {
  it("defaults to a 4-digit numeric token", async () => {
    const { token } = await requestApproval({ request: { id: "tg-default", operation: "op", description: "d" } });
    expect(token).toMatch(/^\d{4}$/);
  });

  it.each([4, 6, 8])("honors tokenLength=%i digits", async (tokenLength) => {
    const { token } = await requestApproval({
      request: { id: `tg-len-${tokenLength}`, operation: "op", description: "d" },
      options: { tokenLength },
    });
    expect(token).toMatch(new RegExp(`^\\d{${tokenLength}}$`));
  });

  it("uses a caller-supplied generator when given (overrides tokenLength)", async () => {
    const { token } = await requestApproval({
      request: { id: "tg-custom", operation: "op", description: "d" },
      options: { tokenLength: 8, tokenGenerator: () => "CUSTOM-TOKEN-123" },
    });
    expect(token).toBe("CUSTOM-TOKEN-123");
  });
});

describe("buildFallbackFileContent — token must never reach disk", () => {
  it("omits the token and includes only non-secret metadata", () => {
    const request: ApprovalRequest = {
      id: "id-1",
      operation: "delete",
      description: "remove node X",
    };
    const body = buildFallbackFileContent({ request, expiresAt: Date.now() + 1000 });
    expect(body).toContain("delete");
    expect(body).toContain("remove node X");
    // The 4-digit token space must not appear; assert the guarantee explicitly.
    expect(body).toMatch(/desktop notification only/);
    expect(body).not.toMatch(/Token:/);
  });
});
