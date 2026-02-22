/**
 * Vitest Setup File
 *
 * This runs before each test file to set up global mocks.
 */

import { vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Clean up persisted workflow states
const PERSIST_DIR = path.join(os.tmpdir(), "mcp-draft-workflows");
await fs.rm(PERSIST_DIR, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(PERSIST_DIR, { recursive: true }).catch(() => {});

// Clean up approval directory
const APPROVAL_DIR = path.join(os.tmpdir(), "mcp-approval");
await fs.rm(APPROVAL_DIR, { recursive: true, force: true }).catch(() => {});

// Mock node-notifier to prevent desktop notifications
vi.mock("node-notifier", () => ({
  default: {
    notify: vi.fn(),
  },
  notify: vi.fn(),
}));

// Global mock for mcp-shared to prevent real notifications
vi.mock("mcp-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mcp-shared")>();
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
