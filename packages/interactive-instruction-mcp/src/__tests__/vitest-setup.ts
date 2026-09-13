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

// Nothing clears the approval directory here. `requestApproval` skips the file
// entirely once VITEST is set, so no test ever writes one -- but a developer's
// own MCP server, running on the same machine, does. Deleting it took a live
// pending approval away from a session that had nothing to do with the tests.

// Mock node-notifier to prevent desktop notifications
vi.mock("node-notifier", () => ({
  default: {
    notify: vi.fn(),
  },
  notify: vi.fn(),
}));

// Global mock for mcp-shared to prevent real notifications
vi.mock("mcp-shared/approval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mcp-shared/approval")>();
  return {
    ...actual,
    requestApproval: vi.fn().mockResolvedValue({
      token: "mock-token-global",
      fallbackPath: "/tmp/mock-pending.txt",
    }),
    validateApproval: vi.fn().mockReturnValue({ valid: true }),
    resendApprovalNotification: vi.fn().mockReturnValue(true),
    getApprovalRequestedMessage: vi.fn().mockReturnValue("Approval requested (mocked)."),
    getApprovalRejectionMessage: vi.fn().mockReturnValue("Approval rejected (mocked)."),
  };
});
