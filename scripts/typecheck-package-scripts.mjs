// Type-check every packages/*/scripts directory.
//
// tsx strips types without checking them, and each package's tsconfig.json
// only includes src/, so nothing else would notice a type error in a script
// until it fails at run time. A scripts/ directory without its own
// tsconfig.json is an error rather than skipped: opting out has to be done
// on purpose, here, not by forgetting a file.
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tsc = join(root, "node_modules/.bin/tsc");

const dirs = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join("packages", d.name, "scripts"))
  .filter((dir) => existsSync(join(root, dir)));

const missing = dirs.filter((dir) => !existsSync(join(root, dir, "tsconfig.json")));
if (missing.length > 0) {
  console.error(`These scripts/ directories have no tsconfig.json, so they would not be type-checked:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

let failed = 0;
for (const dir of dirs) {
  try {
    execFileSync(tsc, ["-p", join(dir, "tsconfig.json")], { cwd: root, stdio: "inherit" });
    console.log(`ok  ${dir}`);
  } catch {
    console.error(`FAIL ${dir}`);
    failed += 1;
  }
}
process.exit(failed > 0 ? 1 : 0);
