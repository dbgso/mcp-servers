import { describe, it, expect, afterAll } from "vitest";
import {
  splitHunks,
  renderApprovalPage,
  registerHtmlApproval,
  processHtmlApproval,
  ensureHtmlServer,
  stopHtmlServer,
  HtmlApprovalStrategy,
} from "../utils/approval/html.js";
import { requestApproval, type ApprovalRequest } from "../utils/approval/core.js";

const DIFF = "@@ -1 +1 @@\n-old\n+new\n@@ -5 +5 @@\n-foo\n+bar";

const req = (id: string, what = DIFF): ApprovalRequest => ({
  id,
  operation: "write",
  description: "edit file",
  why: "fix the bug",
  what,
});

afterAll(async () => {
  await stopHtmlServer();
});

describe("splitHunks", () => {
  it("splits a unified diff on @@ markers", () => {
    expect(splitHunks(DIFF)).toHaveLength(2);
  });

  it("treats a non-diff body as a single hunk", () => {
    expect(splitHunks("just some text")).toEqual(["just some text"]);
  });
});

describe("reviewBody guard", () => {
  it("rejects registering an HTML approval without `what`", async () => {
    await expect(
      registerHtmlApproval({ id: "no-what", operation: "op", description: "d" }),
    ).rejects.toThrow(/requires ApprovalRequest\.what/);
  });
});

describe("processHtmlApproval", () => {
  async function tokenFor(request: ApprovalRequest): Promise<string> {
    await registerHtmlApproval(request);
    // Re-issue to obtain the token deterministically (present() hides it).
    const { token } = await requestApproval({ request });
    return token;
  }

  it("rejects when not every hunk is acknowledged", async () => {
    const r = req("h-partial");
    const token = await tokenFor(r);
    const res = processHtmlApproval({ requestId: r.id, token, ackedHunkIndexes: [0] });
    expect(res).toEqual({ ok: false, reason: "hunks_not_acknowledged" });
  });

  it("rejects a missing token even with all hunks acknowledged", async () => {
    const r = req("h-notoken");
    await tokenFor(r);
    const res = processHtmlApproval({ requestId: r.id, token: undefined, ackedHunkIndexes: [0, 1] });
    expect(res).toEqual({ ok: false, reason: "missing_token" });
  });

  it("rejects a wrong token", async () => {
    const r = req("h-wrongtoken");
    await tokenFor(r);
    const res = processHtmlApproval({ requestId: r.id, token: "0000", ackedHunkIndexes: [0, 1] });
    expect(res).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("approves with all hunks acked + correct token, then validate() is content-bound", async () => {
    const r = req("h-ok");
    const token = await tokenFor(r);
    const res = processHtmlApproval({ requestId: r.id, token, ackedHunkIndexes: [0, 1] });
    expect(res).toEqual({ ok: true });

    const strategy = new HtmlApprovalStrategy();
    // Matching content → valid.
    expect(strategy.validate({ requestId: r.id, currentWhat: DIFF })).toEqual({ valid: true });
  });

  it("validate() rejects a swapped change after approval", async () => {
    const r = req("h-swap");
    const token = await tokenFor(r);
    processHtmlApproval({ requestId: r.id, token, ackedHunkIndexes: [0, 1] });
    const strategy = new HtmlApprovalStrategy();
    expect(strategy.validate({ requestId: r.id, currentWhat: `${DIFF}TAMPER` })).toEqual({
      valid: false,
      reason: "content_mismatch",
    });
  });

  it("validate() reports pending before the human approves", () => {
    const strategy = new HtmlApprovalStrategy();
    expect(strategy.validate({ requestId: "never-approved", currentWhat: DIFF })).toEqual({
      valid: false,
      reason: "not_found",
    });
  });
});

describe("renderApprovalPage", () => {
  it("shows the reason, every hunk, and a token field", async () => {
    const r = req("h-render");
    const session = await registerHtmlApproval(r);
    const html = renderApprovalPage(session);
    expect(html).toContain("fix the bug"); // why
    expect(html).toContain('name="token"'); // token gate
    expect(html).toContain('value="0"'); // hunk 0 ack
    expect(html).toContain('value="1"'); // hunk 1 ack
  });
});

describe("HTTP server", () => {
  it("binds to 127.0.0.1 and serves the review page; POST without token is rejected", async () => {
    const r = req("h-http");
    await registerHtmlApproval(r);
    const base = await ensureHtmlServer();
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const getRes = await fetch(`${base}/approve/${r.id}`);
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toContain('name="token"');

    // Agent-style POST without the out-of-band token must fail.
    const postRes = await fetch(`${base}/approve/${r.id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "ack=0&ack=1",
    });
    expect(postRes.status).toBe(400);
  });
});
