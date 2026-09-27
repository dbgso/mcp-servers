#!/usr/bin/env node
/**
 * The packages CI runs tests for, and what each one needs running beside it.
 *
 * Derived rather than listed. A package added without a line in a workflow is
 * a package whose tests never run, and nothing goes red to say so -- the same
 * shape as a check that cannot fail. So the matrix is read off the packages
 * themselves:
 *
 * - a package is in it if it has a `test` script;
 * - it gets the floci emulator if it has a `*.floci.test.ts` file, which is the
 *   convention those tests already use, and they are the ones gated on
 *   `describe.skipIf(!hasEmulator)`. Deriving it from the same files the gate
 *   reads is what keeps the two from disagreeing: a forgotten emulator would
 *   otherwise mean tests that skip in silence.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const packagesDir = path.join(import.meta.dirname, "..", "packages");

/** Whether any file under `dir` is one of the emulator-gated tests. */
async function needsFloci(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && entry.name.endsWith(".floci.test.ts"));
}

const matrix = [];
for (const name of (await fs.readdir(packagesDir)).sort()) {
  const dir = path.join(packagesDir, name);
  const manifest = await fs
    .readFile(path.join(dir, "package.json"), "utf-8")
    .then(JSON.parse)
    .catch(() => null);
  if (manifest?.scripts?.test === undefined) continue;

  matrix.push({ name, floci: await needsFloci(dir) });
}

if (matrix.length === 0) {
  console.error("No package has a `test` script, which cannot be right.");
  process.exit(1);
}

process.stdout.write(JSON.stringify(matrix));
