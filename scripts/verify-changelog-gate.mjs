#!/usr/bin/env node
/**
 * Refuses a release in which a package would be published without having gone
 * through a changeset.
 *
 * `changeset publish` never looks at changesets. It publishes every non-private
 * package whose `package.json` version is missing from the registry -- so a
 * hand-edited version, or removing `private` from a package sitting at an
 * unpublished version, goes straight to npm on the next push to `main`.
 *
 * `changeset version` always writes a `## <version>` section into the
 * package's CHANGELOG.md, so that section is the evidence a version came from a
 * changeset. Every version about to be published must have one; if any does
 * not, nothing is published.
 *
 * Usage: node scripts/verify-changelog-gate.mjs   (run from the repository root)
 */
import { readFile, glob } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Whether a CHANGELOG has the section `changeset version` writes for `version`. */
export function hasChangelogEntry(changelog, version) {
  if (changelog === null) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^## ${escaped}[ \\t]*$`, "m").test(changelog);
}

/**
 * The packages `changeset publish` would publish without a changeset behind
 * them.
 *
 * Mirrors what changesets decides to publish: not private, and the version is
 * not on the registry yet. Anything already published is not going out again,
 * whatever its CHANGELOG says.
 */
export function findUngatedReleases(candidates) {
  return candidates
    .filter((c) => c.private !== true && !c.published)
    .filter((c) => !hasChangelogEntry(c.changelog, c.version))
    .map((c) => ({
      name: c.name,
      version: c.version,
      reason: c.changelog === null ? "no CHANGELOG.md" : `no "## ${c.version}" section in CHANGELOG.md`,
    }));
}

/**
 * Whether the registry already has this exact version.
 *
 * Any answer other than a packument or a 404 throws: the gate must fail closed,
 * not read a registry outage as "unpublished" or "published".
 */
async function isPublished(name, version) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Unexpected ${res.status} from the registry for ${name}`);
  const packument = await res.json();
  return Object.hasOwn(packument.versions ?? {}, version);
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const candidates = [];
  for await (const file of glob("packages/*/package.json")) {
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (manifest.private === true) continue;
    candidates.push({
      name: manifest.name,
      version: manifest.version,
      private: manifest.private,
      published: await isPublished(manifest.name, manifest.version),
      changelog: await readOptional(join(dirname(file), "CHANGELOG.md")),
    });
  }

  for (const c of candidates) {
    console.log(`${c.name}@${c.version}: ${c.published ? "already published" : "to be published"}`);
  }

  const ungated = findUngatedReleases(candidates);
  if (ungated.length === 0) {
    console.log("Every version to be published has a CHANGELOG entry from a changeset.");
    return;
  }

  for (const u of ungated) {
    console.error(`::error::${u.name}@${u.version} would be published without a changeset (${u.reason})`);
  }
  console.error(
    "\nNothing was published. A version reaches npm only through `pnpm changeset` and the\n" +
      "version PR. Revert the version to the published one and add a changeset instead.",
  );
  process.exit(1);
}

// Only run the CLI when invoked directly, so the pure helpers stay importable.
if (process.argv[1]?.endsWith("verify-changelog-gate.mjs")) {
  await main();
}
