/**
 * Vitest Setup File
 *
 * This runs before each test file to set up global mocks.
 */

import { vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Give this file its own directory for persisted workflow state.
//
// This file runs once per test file, and vitest runs test files in parallel.
// Pointing them all at one directory and deleting it here meant a file starting
// up erased state a file already running was about to read back -- a workflow
// would reload as `editing` after having been approved. Measured on a single
// run of this suite, the shared directory was destroyed and recreated 11 times
// while tests were using it.
//
// A fresh directory per file removes the sharing rather than the symptom, and
// needs no cleanup: the OS owns temporary directories.
process.env.MCP_DRAFT_PERSIST_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-draft-workflows-"));

// Nothing wipes the approval directory here any more. `mcp-shared/approval` is
// mocked below, so this package never reads it -- but `pnpm -r test` runs
// packages concurrently, and mcp-shared's own approval tests do use the default
// path. Deleting it from here reached into another package's test run.

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
