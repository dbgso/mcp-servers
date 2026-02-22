/**
 * Test Setup
 *
 * Cleans up persisted workflow states before tests to prevent
 * real notifications from being triggered.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const PERSIST_DIR = path.join(os.tmpdir(), "mcp-draft-workflows");

// Clean up persisted workflow states before tests
export async function setup() {
  try {
    await fs.rm(PERSIST_DIR, { recursive: true, force: true });
    await fs.mkdir(PERSIST_DIR, { recursive: true });
  } catch {
    // Ignore errors
  }
}
