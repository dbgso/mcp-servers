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

/** A `@@` line opens a hunk — except the first one, which has nothing to close. */
function startsNewHunk(params: { line: string; current: string[] }): boolean {
  const { line, current } = params;
  return line.startsWith("@@") && current.length > 0;
}

/** Flush the hunk still being accumulated, falling back to the whole body if there was no `@@` at all. */
function withTrailingHunk(params: {
  hunks: string[];
  current: string[];
  body: string;
}): string[] {
  const { hunks, current, body } = params;
  if (current.length > 0) hunks.push(current.join("\n"));
  return hunks.length > 0 ? hunks : [body];
}

/** Split a unified-diff-ish body into hunks. Non-diff bodies become one hunk. */
export function splitHunks(body: string): string[] {
  const hunks: string[] = [];
  let current: string[] = [];
  for (const line of body.split("\n")) {
    if (startsNewHunk({ line, current })) {
      hunks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  return withTrailingHunk({ hunks, current, body });
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
 * Every hunk must be ticked. Partial acknowledgment is exactly the
 * rubber-stamping this screen exists to make expensive.
 */
function allHunksAcknowledged(params: {
  session: HtmlSession;
  ackedHunkIndexes: number[];
}): boolean {
  const { session, ackedHunkIndexes } = params;
  const acked = new Set(ackedHunkIndexes);
  return session.hunks.every((_, i) => acked.has(i));
}

/** Why this submission is refused, or `undefined` to record the approval. */
function submissionRefusal(params: {
  session: HtmlSession;
  sub: HtmlSubmission;
}): HtmlSubmissionResult["reason"] {
  const { session, sub } = params;
  if (!allHunksAcknowledged({ session, ackedHunkIndexes: sub.ackedHunkIndexes })) {
    return "hunks_not_acknowledged";
  }

  const validation = validateApproval({
    requestId: sub.requestId,
    providedToken: sub.token,
    currentWhat: reviewBody(session.request),
  });
  if (validation.valid) return undefined;
  return validation.reason;
}

/**
 * Process a human's approval submission from the HTML page. Requires every hunk
 * acknowledged and a valid, content-bound token. On success the session is
 * marked approved and bound to the reviewed body's hash.
 */
export function processHtmlApproval(sub: HtmlSubmission): HtmlSubmissionResult {
  const session = getLiveSession(sub.requestId);
  if (!session) return { ok: false, reason: "not_found" };

  const refusal = submissionRefusal({ session, sub });
  if (refusal !== undefined) return { ok: false, reason: refusal };

  session.approved = true;
  session.approvedHash = contentHash(reviewBody(session.request));
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

/** The approval this URL addresses, or `undefined` for any other path. */
function approvalIdOf(url: string | undefined): string | undefined {
  const { pathname } = new URL(url ?? "/", "http://127.0.0.1");
  const match = /^\/approve\/([^/]+)$/.exec(pathname);
  if (!match) return undefined;
  return decodeURIComponent(match[1]);
}

/**
 * Collect the approval form and answer it.
 *
 * Read as it arrives rather than buffered wholesale, so an oversized body is
 * refused while it is still arriving instead of after it has all been held.
 */
function readApprovalSubmission(params: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  id: string;
}): void {
  const { req, res, id } = params;
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
}

/** Serve the review screen, or take a submission for it. */
function serveApproval(params: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  id: string;
  session: HtmlSession;
}): void {
  const { req, res, id, session } = params;
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderApprovalPage(session));
    return;
  }
  if (req.method === "POST") {
    readApprovalSubmission({ req, res, id });
    return;
  }
  res.writeHead(405).end("method not allowed");
}

// eslint-disable-next-line custom/single-params-object -- Node's request handler signature is fixed as (req, res)
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const id = approvalIdOf(req.url);
  if (id === undefined) {
    res.writeHead(404).end("not found");
    return;
  }
  const session = getLiveSession(id);
  if (!session) {
    res.writeHead(404).end("unknown approval");
    return;
  }
  serveApproval({ req, res, id, session });
}

/** A server is only usable once it exists *and* has had its port resolved into a URL. */
function runningBaseUrl(): string | undefined {
  if (server === null || baseUrl === "") return undefined;
  return baseUrl;
}

async function startHtmlServer(): Promise<string> {
  const created = http.createServer(handleRequest);
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  server = created;
  const addr = created.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  return baseUrl;
}

/**
 * Start the approval server on an ephemeral 127.0.0.1 port. Concurrency-safe:
 * overlapping callers share a single in-flight startup promise, so exactly one
 * server is ever created.
 */
export async function ensureHtmlServer(): Promise<string> {
  const running = runningBaseUrl();
  if (running !== undefined) return running;
  starting ??= startHtmlServer();
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

/** A session a human actually finished reviewing. An unfinished one authorises nothing. */
function approvedSession(requestId: string): HtmlSession | undefined {
  const session = getLiveSession(requestId);
  if (session === undefined || !session.approved) return undefined;
  return session;
}

/**
 * Whether the change now being executed is byte-identical to the body that was
 * ticked through. Nothing to compare against is a mismatch, not a pass.
 */
function matchesApprovedBody(params: {
  session: HtmlSession;
  currentWhat: string | undefined;
}): boolean {
  const { session, currentWhat } = params;
  return currentWhat !== undefined && contentHash(currentWhat) === session.approvedHash;
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
    const session = approvedSession(params.requestId);
    if (session === undefined) {
      return { valid: false, reason: "not_found" };
    }
    if (!matchesApprovedBody({ session, currentWhat: params.currentWhat })) {
      return { valid: false, reason: "content_mismatch" };
    }
    sessions.delete(params.requestId);
    return { valid: true };
  }
}
