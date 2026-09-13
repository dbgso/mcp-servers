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

// Nothing in this package requests an approval any more: every gated mutation
// goes through the deliberation gate, which is process memory and needs no
// directory, no notifier and no token. What used to live here -- a node-notifier
// mock to stop real desktop notifications, spies over `requestApproval` /
// `validateApproval`, and `MCP_APPROVAL_TEST_TOKEN` so tests could know the
// token the gate minted -- has no subject left.
//
// Tests that exercise a gate call `resetMutationGatesForTesting()` instead: a
// gate outlives a single case, so a run opened by one test would otherwise let
// the next one through on its first attempt.
