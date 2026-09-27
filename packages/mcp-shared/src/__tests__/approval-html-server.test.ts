/**
 * The local review screen's HTTP surface.
 *
 * `handleRequest` was the untested half of `html.ts`: every response that is
 * not the happy path -- an unknown URL, an approval that has expired or never
 * existed, a method the page does not use, a body too large to be a form --
 * plus the session sweep behind them. A review screen that answers 200 to the
 * wrong things is worse than one that is not there, because the caller cannot
 * tell which change was approved.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

import {
  ensureHtmlServer,
  processHtmlApproval,
  registerHtmlApproval,
  renderApprovalPage,
  splitHunks,
  stopHtmlServer,
} from "../utils/approval/html.js";

const request = (extra: Record<string, unknown> = {}) => ({
  id: `html::${Math.random().toString(36).slice(2, 8)}`,
  operation: "Apply update",
  description: "one file",
  what: "@@ -1 +1 @@\n-old\n+new",
  ...extra,
});

afterEach(async () => {
  await stopHtmlServer();
  vi.useRealTimers();
});

describe("what the server answers", () => {
  it("serves the review page for a live approval", async () => {
    const r = request();
    await registerHtmlApproval(r);
    const base = await ensureHtmlServer();

    const response = await fetch(`${base}/approve/${encodeURIComponent(r.id)}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Approval required");
  });

  it("answers 404 for a path that is not an approval", async () => {
    const base = await ensureHtmlServer();

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/something/else`)).status).toBe(404);
  });

  it("answers 404 for an approval it has never heard of", async () => {
    const base = await ensureHtmlServer();

    const response = await fetch(`${base}/approve/absent`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("unknown approval");
  });

  it("answers 405 to a method the page never uses", async () => {
    const r = request();
    await registerHtmlApproval(r);
    const base = await ensureHtmlServer();

    const response = await fetch(`${base}/approve/${encodeURIComponent(r.id)}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(405);
  });

  it("rejects a form that does not acknowledge the hunks", async () => {
    const r = request();
    await registerHtmlApproval(r);
    const base = await ensureHtmlServer();

    const response = await fetch(`${base}/approve/${encodeURIComponent(r.id)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "token=1234",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("hunks_not_acknowledged");
  });

  it("refuses a body too large to be one of its own forms", async () => {
    // The page posts a token and a few checkbox indexes. Anything megabytes
    // long is not that, and buffering it would be the only cost of finding out.
    const r = request();
    await registerHtmlApproval(r);
    const base = await ensureHtmlServer();

    const response = await fetch(`${base}/approve/${encodeURIComponent(r.id)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${"9".repeat(200_000)}`,
    }).catch((error: unknown) => error);

    // The server answers 413 and destroys the connection; either the response
    // or the aborted fetch is an acceptable observation of that.
    if (response instanceof Error) {
      expect(response).toBeInstanceOf(Error);
    } else {
      expect(response.status).toBe(413);
    }
  });

  it("serves one server for the whole process", async () => {
    const first = await ensureHtmlServer();
    const second = await ensureHtmlServer();

    expect(second).toBe(first);
    expect(first).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("can be stopped twice", async () => {
    await ensureHtmlServer();

    await expect(stopHtmlServer()).resolves.toBeUndefined();
    await expect(stopHtmlServer()).resolves.toBeUndefined();
  });
});

describe("a session that has run out", () => {
  it("is treated as absent by the submission handler", async () => {
    const r = request();
    await registerHtmlApproval(r);

    // Sessions live five minutes; move past that.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    expect(processHtmlApproval({ requestId: r.id, token: "1234", ackedHunkIndexes: [0] })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("is swept when another approval is registered", async () => {
    const stale = request();
    await registerHtmlApproval(stale);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    // Registering prunes; the stale session should be gone rather than
    // accumulating for the life of the process.
    await registerHtmlApproval(request());
    vi.useRealTimers();

    const base = await ensureHtmlServer();
    expect((await fetch(`${base}/approve/${encodeURIComponent(stale.id)}`)).status).toBe(404);
  });
});

describe("the page itself", () => {
  it("says so when no reason was supplied", async () => {
    // A review screen with an empty "why" reads as a bug in the caller; the
    // placeholder makes it obvious which one is missing.
    const session = await registerHtmlApproval(request());

    expect(renderApprovalPage(session)).toContain("(no reason supplied)");
  });

  it("shows the reason when there is one", async () => {
    const session = await registerHtmlApproval(request({ why: "the document is wrong" }));

    expect(renderApprovalPage(session)).toContain("the document is wrong");
  });

  it("escapes what it renders", async () => {
    const session = await registerHtmlApproval(
      request({ operation: "<script>alert(1)</script>", what: "@@ -1 +1 @@\n-<b>" })
    );

    const page = renderApprovalPage(session);

    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;");
  });
});

describe("splitHunks", () => {
  it("keeps a trailing hunk that has no marker after it", () => {
    const hunks = splitHunks("@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d");

    expect(hunks).toHaveLength(2);
    expect(hunks[1]).toContain("-c");
  });

  it("returns the body itself when there is nothing to split on", () => {
    expect(splitHunks("just a sentence")).toEqual(["just a sentence"]);
  });

  it("returns the body for an empty string rather than an empty list", () => {
    // An empty list would render a form with no hunks, which submits as
    // "everything acknowledged".
    expect(splitHunks("")).toEqual([""]);
  });
});
