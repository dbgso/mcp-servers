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
 * - it is split across runners if it declares `ciShards`, which is where a
 *   package that is slow enough to be the whole run's critical path says so.
 *
 * `ciShards` and coverage thresholds cannot both be set, and this refuses the
 * combination rather than letting CI discover it: `--shard` gives each runner a
 * subset of the files, so each one measures coverage of a subset and fails a
 * threshold written for the whole. Vitest can merge blob reports to get both,
 * and nothing here needs that yet.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const packagesDir = path.join(import.meta.dirname, "..", "packages");

/** Whether any file under `dir` is one of the emulator-gated tests. */
async function needsFloci(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && entry.name.endsWith(".floci.test.ts"));
}

/**
 * Whether the package's vitest config asks for coverage thresholds.
 *
 * Read as text rather than by loading the config, which would mean running it.
 * A false positive here refuses a shard split that would have been fine; a false
 * negative lets CI fail on every shard of a package, which is the worse way round
 * to be wrong.
 */
async function hasCoverageThresholds(dir) {
  for (const file of ["vitest.config.ts", "vitest.config.mts", "vitest.config.js"]) {
    const source = await fs.readFile(path.join(dir, file), "utf-8").catch(() => null);
    if (source !== null && source.includes("thresholds")) return true;
  }
  return false;
}

const matrix = [];
for (const name of (await fs.readdir(packagesDir)).sort()) {
  const dir = path.join(packagesDir, name);
  const manifest = await fs
    .readFile(path.join(dir, "package.json"), "utf-8")
    .then(JSON.parse)
    .catch(() => null);
  if (manifest?.scripts?.test === undefined) continue;

  const shards = manifest.ciShards ?? 1;
  if (!Number.isInteger(shards) || shards < 1) {
    console.error(`${name}: ciShards must be a positive integer, not ${JSON.stringify(shards)}.`);
    process.exit(1);
  }
  if (shards > 1 && (await hasCoverageThresholds(dir))) {
    console.error(
      `${name}: ciShards is ${shards} and its vitest config sets coverage thresholds. ` +
      "Each shard would measure a subset of the files and fail a threshold written " +
      "for all of them. Drop one of the two, or merge blob reports."
    );
    process.exit(1);
  }

  const floci = await needsFloci(dir);
  for (let shard = 1; shard <= shards; shard++) {
    matrix.push({ name, floci, shard, shards });
  }
}

if (matrix.length === 0) {
  console.error("No package has a `test` script, which cannot be right.");
  process.exit(1);
}

process.stdout.write(JSON.stringify(matrix));
