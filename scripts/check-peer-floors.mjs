// The catalog version of each DB driver must satisfy every peer range on it.
//
// The catalog (pnpm-workspace.yaml) is the version the smoke tests run against
// real engines (ci.yml `db-smoke`). A peer range that excludes it -- an exact
// pin left behind by a bump, or a floor above it -- rejects the very version
// the packages are tested with. syncpack (.syncpackrc.json) keeps each
// driver's peers in one `>=` range; this checks that range admits the catalog.
//
// The floor may sit below the catalog version: it is the oldest version a
// package claims to work with, and the catalog moving up (a dependabot bump)
// must not force every floor up with it.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const DRIVERS = ["pg", "mysql2"];

/** `1.2.3` → [1, 2, 3], or null for anything else (prerelease included). */
function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Problems with the peer ranges of `packages` ({ name, peers }) against
 * `catalog` ({ driver: version }). Empty means every range admits the catalog.
 */
export function findPeerProblems({ catalog, packages, drivers = DRIVERS }) {
  const problems = [];
  for (const { name, peers } of packages) {
    for (const driver of drivers) {
      if (!(driver in peers)) continue;
      const where = `${name} peerDependencies.${driver} "${peers[driver]}"`;
      const tested = parseVersion(String(catalog[driver] ?? ""));
      if (tested === null) {
        problems.push(`${where}: the catalog has no plain x.y.z version of ${driver} to check it against`);
        continue;
      }
      const floorText = /^>=\s*(\S+)$/.exec(peers[driver])?.[1];
      const floor = floorText === undefined ? null : parseVersion(floorText);
      if (floor === null) {
        problems.push(`${where}: expected ">=x.y.z"`);
        continue;
      }
      if (compare(floor, tested) > 0) {
        problems.push(`${where}: above the catalog's ${catalog[driver]}, which is the version tested`);
      }
    }
  }
  return problems;
}

if (process.argv[1]?.endsWith("check-peer-floors.mjs")) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const catalog = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")).catalog ?? {};
  const packages = readdirSync(join(root, "packages"))
    .map((dir) => join("packages", dir, "package.json"))
    .filter((file) => existsSync(join(root, file)))
    .map((file) => ({ name: file, peers: JSON.parse(readFileSync(join(root, file), "utf8")).peerDependencies ?? {} }));
  const problems = findPeerProblems({ catalog, packages });
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`every peer range admits the catalog (${DRIVERS.map((d) => `${d} ${catalog[d]}`).join(", ")})`);
}
