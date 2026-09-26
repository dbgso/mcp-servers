/**
 * Every committed flow, run in CI.
 *
 * The flows under `scripts/flows/` were written to explore: one of them swept
 * all fifteen actions and found two defects no test covered, because no test
 * had been written for those calls. But a flow only runs when someone runs one,
 * so the thing that found those defects was not itself part of the net -- the
 * fixes were covered and the means of finding the next one was not.
 *
 * This closes that. It shells out to the runner rather than reimplementing the
 * loop, so the runner is exercised too, and it discovers the files instead of
 * listing them: adding a flow adds coverage here without editing this file, and
 * without writing a test at all.
 *
 * Each flow declares the server it is written against, which is what makes
 * discovery possible -- there is no mapping from file to command line to keep
 * in step.
 */

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(packageRoot, "../..");
const runner = path.join(repoRoot, "scripts/mcp-session.mjs");
const flowDir = path.join(repoRoot, "scripts/flows/interactive-instruction-mcp");

const flows = (await fs.readdir(flowDir)).filter((name) => name.endsWith(".jsonl")).sort();

describe("committed flows", () => {
  it("there are some, so a green run means something", () => {
    // Discovery failing open would make this file pass by testing nothing.
    expect(flows.length).toBeGreaterThan(0);
  });

  it.each(flows.map((flow) => ({ flow })))(
    "$flow passes every expectation it states",
    async ({ flow }) => {
      const result = await run("node", [runner, "interactive-instruction-mcp", path.join(flowDir, flow)], {
        cwd: repoRoot,
        // A sweep of forty-odd calls against a spawned server; the whole point
        // is that it is slower than a unit test.
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
      }).catch((error: unknown) => {
        // execFile rejects on a non-zero exit, and the runner exits 1 with the
        // unmet expectations on stderr -- which is the whole diagnosis.
        const failure = error as { stdout?: string; stderr?: string; code?: number };
        throw new Error(
          `${flow} exited ${failure.code ?? "?"}\n\n${failure.stderr ?? ""}\n\n${(failure.stdout ?? "").slice(-4000)}`
        );
      });

      expect(result.stdout).toMatch(/0 failed ---/);
    },
    130_000
  );
});
