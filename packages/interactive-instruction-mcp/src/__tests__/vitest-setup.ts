/**
 * Vitest Setup File
 *
 * This runs before each test file to set up global mocks.
 */

import { vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Give each parallel vitest worker its OWN persisted-workflow store. The store
// is on disk (WorkflowManager.listAll reads it), so a single shared dir lets
// one worker's per-file wipe delete another worker's in-flight state → flaky
// "recently confirmed" / state-persistence failures. Set the env BEFORE any
// test module imports draft-workflow so the manager picks up the isolated dir.
const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? "0";
const workerTmp = (name: string) => path.join(os.tmpdir(), `${name}-${workerId}`);

// All three of these are process-global on-disk stores read via listAll()/getXxx.
// A single shared dir lets a parallel worker's per-file wipe delete another
// worker's in-flight state → flaky failures. Isolate per worker via env, set
// BEFORE any test module imports the modules that read these dirs.
const PERSIST_DIR = workerTmp("mcp-draft-workflows");
const PENDING_DIR = workerTmp("mcp-instruction-pending");
const DIFF_DIR = workerTmp("mcp-instruction-diffs");
process.env.MCP_DRAFT_PERSIST_DIR = PERSIST_DIR;
process.env.MCP_INSTRUCTION_PENDING_DIR = PENDING_DIR;
process.env.MCP_INSTRUCTION_DIFF_DIR = DIFF_DIR;
for (const dir of [PERSIST_DIR, PENDING_DIR, DIFF_DIR]) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

// Clean up approval directory (approval itself is mocked below, so the shared
// dir is only cosmetic here).
const APPROVAL_DIR = path.join(os.tmpdir(), "mcp-approval");
await fs.rm(APPROVAL_DIR, { recursive: true, force: true }).catch(() => {});

// Mock node-notifier to prevent desktop notifications
vi.mock("node-notifier", () => ({
  default: {
    notify: vi.fn(),
  },
  notify: vi.fn(),
}));

// The approval module is spied on, NOT stubbed.
//
// It used to be stubbed, with `validateApproval` hardwired to `{ valid: true }`,
// which meant no test in this package ever ran the approval gate: every token
// was accepted, and swapping the promotion target or the draft content after
// approval looked like an ordinary success. Whole classes of bug were
// invisible to a green suite.
//
// `vi.fn(actual.x)` keeps the call counts tests assert on while running the
// real implementation, so an invalid token, an expired approval or a content
// mismatch fails the way it would in production.
//
// The token is fixed instead. `requestApproval` honors MCP_APPROVAL_TEST_TOKEN
// only under a test run, and skips both the desktop notification and the
// fallback file there, so this has no side effects -- a test simply knows the
// token the real gate minted.
process.env.MCP_APPROVAL_TEST_TOKEN = "valid-token";

vi.mock("mcp-shared/approval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mcp-shared/approval")>();
  return {
    ...actual,
    requestApproval: vi.fn(actual.requestApproval),
    validateApproval: vi.fn(actual.validateApproval),
  };
});
