// A peer range's floor must be the catalog version.
//
// The catalog (pnpm-workspace.yaml) is the version the smoke tests run against
// real engines (ci.yml `db-smoke`). A peer floor below it claims support for
// versions nothing here has run; above it, the packages would reject the very
// version they are tested with. syncpack (.syncpackrc.json) keeps each
// driver's peers in one `>=` range; this checks where that range starts.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DRIVERS = ["pg", "mysql2"];
const root = new URL("..", import.meta.url).pathname;
const catalog = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")).catalog ?? {};

const problems = [];
for (const dir of readdirSync(join(root, "packages"))) {
  const file = join(root, "packages", dir, "package.json");
  if (!existsSync(file)) continue;
  const peers = JSON.parse(readFileSync(file, "utf8")).peerDependencies ?? {};
  for (const name of DRIVERS) {
    if (!(name in peers)) continue;
    const want = `>=${catalog[name]}`;
    if (peers[name] !== want) {
      problems.push(`packages/${dir}/package.json peerDependencies.${name} is "${peers[name]}", want "${want}" (catalog ${catalog[name]})`);
    }
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`peer floors match the catalog (${DRIVERS.map((d) => `${d} ${catalog[d]}`).join(", ")})`);
