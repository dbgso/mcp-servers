/**
 * This server delivers no desktop notification, and nothing reaches for one.
 *
 * Every gated mutation goes through the deliberation gate. That is a decision
 * about the product, not an implementation detail: the notification cost a
 * human round trip on every maintenance operation and could not be delivered
 * at all in the headless and SSH sessions this server mostly runs in, where the
 * failure mode was that the operation became impossible.
 *
 * The way it came back last time was one handler at a time -- a new action
 * written against `requestApproval` because that was what the handler next to
 * it did. So this is asserted over the source rather than over behaviour: a
 * behavioural test only covers the actions someone thought to test.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.resolve(srcDir, "..");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // The tests themselves are allowed to name these; they are what says
        // the token flow is gone.
        return entry.name === "__tests__" ? [] : sourceFiles(full);
      }
      return entry.name.endsWith(".ts") ? [full] : [];
    })
  );
  return files.flat();
}

describe("no desktop notification", () => {
  it("does not import the token approval flow anywhere", async () => {
    const files = await sourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      // Only actual uses, not the comments explaining why they are gone.
      const code = content
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
        .join("\n");

      if (/\b(requestApproval|validateApproval|resendApprovalNotification)\s*\(/.test(code)) {
        offenders.push(path.relative(packageDir, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not depend on node-notifier", async () => {
    const manifest: unknown = JSON.parse(
      await fs.readFile(path.join(packageDir, "package.json"), "utf-8")
    );
    const deps = manifest as { dependencies?: Record<string, string> };

    expect(Object.keys(deps.dependencies ?? {})).not.toContain("node-notifier");
  });
});
