#!/usr/bin/env node
/**
 * Claims the workspace's package names on npm so Trusted Publishing can be set
 * up for them.
 *
 * npm only lets you configure a Trusted Publisher on a package that already
 * exists, and OIDC is what the release workflow relies on -- so the very first
 * publish of every new package cannot use it. This closes that gap once, with a
 * token, by publishing a `0.0.0` placeholder that contains no code.
 *
 * A placeholder rather than the real first version, deliberately: publishing
 * 0.1.0 by hand would leave changesets with nothing to do, so the automated
 * path stays unexercised until some later bump. With a placeholder, the name
 * exists, the Trusted Publisher can be configured, and the real 0.1.0 then goes
 * out through the normal release workflow.
 *
 * Usage:
 *   node scripts/bootstrap-npm-names.mjs              # report only (default)
 *   node scripts/bootstrap-npm-names.mjs --publish    # actually publish stubs
 *
 * Publishing needs NODE_AUTH_TOKEN. A granular token scoped to publish, with a
 * short expiry, is enough -- revoke it once the Trusted Publishers are set.
 */
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glob } from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** Names npm would accept a publish for: everything not marked private. */
export function publishableNames(manifests) {
  return manifests
    .filter((m) => m.private !== true)
    .map((m) => m.name)
    .sort();
}

/**
 * The placeholder manifest. No `main`, no `bin`, no files -- installing it must
 * do nothing, because someone eventually will.
 */
export function stubManifest(name) {
  return {
    name,
    version: "0.0.0",
    description: `Placeholder reserving the ${name} name. Not a release -- see the repository.`,
    license: "MIT",
    repository: { type: "git", url: "git+https://github.com/dbgso/mcp-servers.git" },
    publishConfig: { access: "public" },
  };
}

/**
 * What the registry says about a name.
 *
 * "Does it exist" is the wrong question: a name can exist and belong to someone
 * else, in which case no token and no Trusted Publisher will ever make the
 * publish succeed. Only the maintainer list distinguishes that from our own
 * already-published packages.
 */
export function classifyName(packument, owner) {
  if (packument === null) return "free";
  const maintainers = (packument.maintainers ?? []).map((m) => m.name);
  return maintainers.includes(owner) ? "ours" : "taken";
}

/** Group names by classification, preserving input order within each group. */
export function partitionByOwnership(names, classificationByName) {
  const of = (want) => names.filter((n) => (classificationByName[n] ?? "free") === want);
  return { free: of("free"), ours: of("ours"), taken: of("taken") };
}

/** The packument for a name, or null when the registry has never seen it. */
async function fetchPackument(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Unexpected ${res.status} from the registry for ${name}`);
  return await res.json();
}

async function publishStub(name) {
  const dir = await mkdtemp(join(tmpdir(), "npm-bootstrap-"));
  await writeFile(join(dir, "package.json"), JSON.stringify(stubManifest(name), null, 2) + "\n");
  await writeFile(
    join(dir, "README.md"),
    `# ${name}\n\nPlaceholder reserving this name so npm Trusted Publishing can be configured.\n` +
      `The first real release is published by CI. See https://github.com/dbgso/mcp-servers.\n`,
  );
  await execFileAsync("npm", ["publish", "--access", "public"], { cwd: dir });
}

async function main() {
  const shouldPublish = process.argv.includes("--publish");

  const manifests = [];
  for await (const file of glob("packages/*/package.json")) {
    manifests.push(JSON.parse(await readFile(file, "utf8")));
  }
  const names = publishableNames(manifests);

  const owner = process.env.NPM_OWNER ?? "dbgso";
  const classification = {};
  for (const name of names) classification[name] = classifyName(await fetchPackument(name), owner);
  const { free, ours, taken } = partitionByOwnership(names, classification);

  console.log(`${ours.length} already ours, ${free.length} free to claim, ${taken.length} taken by someone else.`);
  for (const name of ours) console.log(`  ours   ${name}`);
  for (const name of free) console.log(`  free   ${name}`);
  for (const name of taken) console.log(`  TAKEN  ${name}`);

  if (taken.length > 0) {
    console.error(
      `\n${taken.length} name(s) belong to another npm account. No token and no Trusted\n` +
        `Publisher can publish these -- they need a scope (@${owner}/...) or a rename\n` +
        `before any release, or the release workflow will fail on them forever.`,
    );
  }

  if (free.length === 0) {
    if (taken.length > 0) process.exit(1);
    return;
  }

  if (!shouldPublish) {
    console.log("\nReport only. Re-run with --publish to claim the free names.");
    if (taken.length > 0) process.exit(1);
    return;
  }
  if (!process.env.NODE_AUTH_TOKEN) {
    console.error("\nNODE_AUTH_TOKEN is not set; publishing would fail. Aborting.");
    process.exit(2);
  }

  for (const name of free) {
    console.log(`publishing placeholder ${name}@0.0.0`);
    await publishStub(name);
  }
  console.log(`\nClaimed ${free.length} name(s). Configure a Trusted Publisher for each:`);
  console.log("  https://www.npmjs.com/package/<name>/access");
  console.log("Then revoke the token used here.");
}

// Only run the CLI when invoked directly, so the pure helpers stay importable.
if (process.argv[1]?.endsWith("bootstrap-npm-names.mjs")) {
  await main();
}
