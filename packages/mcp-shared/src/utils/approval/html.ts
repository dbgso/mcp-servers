import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  requestApproval,
  validateApproval,
  contentHash,
  type ApprovalRequest,
  type ApprovalResult,
} from "./core.js";
import type { ApprovalStrategy, ApprovalPresentResult } from "./strategy.js";

/**
 * HTML approval strategy.
 *
 * A local review screen (bound to 127.0.0.1) shows the tool-computed diff, the
 * stated reason, and a per-hunk acknowledgment checklist. To submit approval a
 * human must (a) acknowledge every hunk and (b) enter the token that was
 * delivered out-of-band via desktop notification — never written to disk.
 *
 * Why this resists an agent that has both a shell and browser automation:
 * reaching or rendering the page does not help, because the POST that records
 * approval requires the notification-only token the agent cannot read. The
 * per-hunk acknowledgment raises the cost of a human rubber-stamping without
 * reading. Approval is content-bound to the exact diff.
 */

interface HtmlSession {
  request: ApprovalRequest;
  /** Review body split into hunks; each must be acknowledged to approve. */
  hunks: string[];
  approved: boolean;
  /** sha256 of the reviewed body, captured at approval time for content binding. */
  approvedHash?: string;
  /** Epoch ms after which the session is abandoned and swept. */
  expiresAt: number;
}

/** How long an unreviewed HTML approval lives before being swept (matches the token TTL). */
const SESSION_TTL_MS = 5 * 60 * 1000;

const sessions = new Map<string, HtmlSession>();

/** Drop every expired session so the map cannot grow without bound. */
function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(id);
  }
}

/** Fetch a session only if it is still live; expired sessions are swept and treated as absent. */
function getLiveSession(id: string): HtmlSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() > session.expiresAt) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

/** Split a unified-diff-ish body into hunks. Non-diff bodies become one hunk. */
export function splitHunks(body: string): string[] {
  const lines = body.split("\n");
  const hunks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@@") && current.length > 0) {
      hunks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) hunks.push(current.join("\n"));
  return hunks.length > 0 ? hunks : [body];
}

/** The body a human reviews. HTML approval requires a tool-computed `what`. */
function reviewBody(request: ApprovalRequest): string {
  if (request.what === undefined || request.what.trim() === "") {
    throw new Error(
      "HTML approval requires ApprovalRequest.what (the tool-computed diff to review).",
    );
  }
  return request.what;
}

/**
 * Register an HTML approval session and fire the out-of-band token notification.
 * Split out from the HTTP server so the approval logic is testable without a
 * live socket.
 */
export async function registerHtmlApproval(request: ApprovalRequest): Promise<HtmlSession> {
  const body = reviewBody(request);
  pruneExpiredSessions();
  const session: HtmlSession = {
    request,
    hunks: splitHunks(body),
    approved: false,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(request.id, session);
  // Deliver the approval token via desktop notification only.
  await requestApproval({ request });
  return session;
}

export interface HtmlSubmission {
  requestId: string;
  token?: string;
  ackedHunkIndexes: number[];
}

export interface HtmlSubmissionResult {
  ok: boolean;
  reason?: "not_found" | "hunks_not_acknowledged" | ApprovalResult["reason"];
}

/**
 * Process a human's approval submission from the HTML page. Requires every hunk
 * acknowledged and a valid, content-bound token. On success the session is
 * marked approved and bound to the reviewed body's hash.
 */
export function processHtmlApproval(sub: HtmlSubmission): HtmlSubmissionResult {
  const session = getLiveSession(sub.requestId);
  if (!session) return { ok: false, reason: "not_found" };

  const acked = new Set(sub.ackedHunkIndexes);
  const allAcked = session.hunks.every((_, i) => acked.has(i));
  if (!allAcked) return { ok: false, reason: "hunks_not_acknowledged" };

  const body = reviewBody(session.request);
  const validation = validateApproval({
    requestId: sub.requestId,
    providedToken: sub.token,
    currentWhat: body,
  });
  if (!validation.valid) return { ok: false, reason: validation.reason };

  session.approved = true;
  session.approvedHash = contentHash(body);
  return { ok: true };
}

/** Escape text for safe embedding in HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render the approval review page. Pure so its contents are unit-testable. */
export function renderApprovalPage(session: HtmlSession): string {
  const { request } = session;
  const hunkFields = session.hunks
    .map(
      (h, i) =>
        `<label class="hunk"><input type="checkbox" name="ack" value="${i}" required> ` +
        `<span>Reviewed hunk ${i + 1}</span><pre>${escapeHtml(h)}</pre></label>`,
    )
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Approve: ${escapeHtml(request.operation)}</title></head>
<body>
<h1>Approval required: ${escapeHtml(request.operation)}</h1>
<h2>Why</h2>
<p class="why">${escapeHtml(request.why ?? "(no reason supplied)")}</p>
<h2>What will change (${session.hunks.length} hunk(s))</h2>
<form method="POST" action="/approve/${encodeURIComponent(request.id)}">
${hunkFields}
<p><label>Approval token (from desktop notification):
<input type="text" name="token" required inputmode="numeric" autocomplete="off"></label></p>
<button type="submit">Approve this exact change</button>
</form>
</body></html>`;
}

// --- HTTP server lifecycle -------------------------------------------------

let server: http.Server | null = null;
let baseUrl = "";
let starting: Promise<string> | null = null;

/** Cap on the approval POST body — the form is tiny; anything larger is refused. */
const MAX_BODY_BYTES = 64 * 1024;

function parseFormBody(raw: string): { token?: string; ack: number[] } {
  const params = new URLSearchParams(raw);
  const token = params.get("token") ?? undefined;
  const ack = params
    .getAll("ack")
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isInteger(n));
  return { token, ack };
}

// eslint-disable-next-line custom/single-params-object -- Node's request handler signature is fixed as (req, res)
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const match = /^\/approve\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    res.writeHead(404).end("not found");
    return;
  }
  const id = decodeURIComponent(match[1]);
  const session = getLiveSession(id);
  if (!session) {
    res.writeHead(404).end("unknown approval");
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderApprovalPage(session));
    return;
  }
  if (req.method === "POST") {
    let raw = "";
    let tooLarge = false;
    req.on("data", (c) => {
      if (tooLarge) return;
      raw += c;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413).end("payload too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      const { token, ack } = parseFormBody(raw);
      const result = processHtmlApproval({ requestId: id, token, ackedHunkIndexes: ack });
      if (result.ok) {
        res.writeHead(200, { "content-type": "text/html" }).end("<p>Approved. You may close this tab.</p>");
      } else {
        res.writeHead(400, { "content-type": "text/html" }).end(`<p>Rejected: ${result.reason}</p>`);
      }
    });
    return;
  }
  res.writeHead(405).end("method not allowed");
}

/**
 * Start the approval server on an ephemeral 127.0.0.1 port. Concurrency-safe:
 * overlapping callers share a single in-flight startup promise, so exactly one
 * server is ever created.
 */
export async function ensureHtmlServer(): Promise<string> {
  if (server && baseUrl) return baseUrl;
  starting ??= (async () => {
    const created = http.createServer(handleRequest);
    await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
    server = created;
    const addr = created.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    return baseUrl;
  })();
  return starting;
}

/** Stop the approval server (for tests / shutdown). */
export async function stopHtmlServer(): Promise<void> {
  const active = server;
  server = null;
  baseUrl = "";
  starting = null;
  if (!active) return;
  await new Promise<void>((resolve) => active.close(() => resolve()));
}

export class HtmlApprovalStrategy implements ApprovalStrategy {
  readonly kind = "html" as const;

  async present(request: ApprovalRequest): Promise<ApprovalPresentResult> {
    const url = await ensureHtmlServer();
    // Idempotent: reuse a live session instead of re-registering, which would
    // reset the acknowledgments/approval and rotate the notified token — a
    // caller that polls would otherwise destroy an in-progress human approval.
    if (!getLiveSession(request.id)) {
      await registerHtmlApproval(request);
    }
    const reviewUrl = `${url}/approve/${encodeURIComponent(request.id)}`;
    return {
      requestId: request.id,
      message: `# Approval required

Open the review screen and approve this exact change:

  ${reviewUrl}

You must acknowledge every hunk and enter the token from the desktop
notification. The token is not available by any other means.`,
    };
  }

  validate(params: { requestId: string; currentWhat?: string }): ApprovalResult {
    const session = getLiveSession(params.requestId);
    if (!session || !session.approved) {
      return { valid: false, reason: "not_found" };
    }
    if (
      params.currentWhat === undefined ||
      contentHash(params.currentWhat) !== session.approvedHash
    ) {
      return { valid: false, reason: "content_mismatch" };
    }
    sessions.delete(params.requestId);
    return { valid: true };
  }
}
