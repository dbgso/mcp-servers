#!/usr/bin/env node
/**
 * Guards the publishable bundle contract for a tsup-built package.
 *
 * A published bin inlines the workspace-internal `mcp-shared*` libraries, so
 * nothing may survive in its output that the package does not itself declare.
 * Any bare import left in `dist/` that is neither a node builtin nor a declared
 * dependency would be unresolvable on a consumer machine after `npm i`.
 *
 * Usage: node scripts/verify-bundle.mjs packages/<pkg>
 */
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join } from "node:path";

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Bare module specifiers the bundle actually imports, read from esbuild's
 * metafile.
 *
 * Scanning the emitted JavaScript for import syntax cannot work: bundled code
 * contains string literals -- tool descriptions, JSON Schema text -- that hold
 * things like `from "x"`, and a text scan reports them as imports. The metafile
 * is the bundler's own record, so it distinguishes the two by construction.
 *
 * Relative and absolute specifiers are dropped: they never reach a registry.
 */
export function extractBareImports(metafile) {
  const specifiers = new Set();
  for (const output of Object.values(metafile.outputs ?? {})) {
    for (const imported of output.imports ?? []) {
      // Non-external imports are the bundle's own chunks (`dist/chunk-*.js`
      // once code splitting kicks in). They ship with it and resolve locally.
      if (imported.external !== true) continue;
      const specifier = imported.path;
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}

/** The installable package name a specifier resolves to (`a/b/c` -> `a`, `@s/p/x` -> `@s/p`). */
export function packageNameOf(specifier) {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) return segments.slice(0, 2).join("/");
  return segments[0];
}

/** Specifiers that are neither node builtins nor covered by `declared`. */
export function findUndeclared(specifiers, declared) {
  const allowed = new Set(declared);
  return specifiers.filter((specifier) => {
    if (BUILTINS.has(specifier)) return false;
    return !allowed.has(packageNameOf(specifier));
  });
}

/**
 * Declared dependencies the bundle never imports.
 *
 * The bundle is the whole runtime, so a dependency absent from it is one every
 * consumer installs for nothing. Only meaningful for a bundled package: an
 * unbundled one resolves its deps at runtime, where this would be a false alarm.
 */
export function findUnusedDeclared(specifiers, declared) {
  const imported = new Set(specifiers.map(packageNameOf));
  return declared.filter((name) => !imported.has(name));
}

async function main() {
  const packageDir = process.argv[2];
  if (!packageDir) {
    console.error("usage: node scripts/verify-bundle.mjs packages/<pkg>");
    process.exit(2);
  }

  const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  const metafilePath = join(packageDir, "dist/metafile-esm.json");
  let metafile;
  try {
    metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  } catch {
    console.error(
      `${manifest.name}: ${metafilePath} not found. The tsup config must set ` +
        `\`metafile: true\` -- without it there is nothing trustworthy to verify against.`,
    );
    process.exit(2);
  }

  // peerDependencies count as declared: the consumer installs them, which is
  // exactly what an external import needs. db-read-mcp declares its database
  // drivers that way so a user installs only the one they use.
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
  const imports = extractBareImports(metafile);
  const undeclared = findUndeclared(imports, declared);

  // A workspace-internal library surviving into the output is always a bug:
  // it is never published, so the import can never resolve for a consumer.
  const leakedInternals = imports.filter((specifier) => packageNameOf(specifier).startsWith("mcp-shared"));

  if (leakedInternals.length > 0) {
    console.error(`${manifest.name}: workspace-internal imports left in bundle:`);
    for (const specifier of leakedInternals) console.error(`  - ${specifier}`);
  }
  if (undeclared.length > 0) {
    console.error(`${manifest.name}: bundle imports packages missing from "dependencies":`);
    for (const specifier of undeclared) console.error(`  - ${specifier}`);
  }

  const unused = findUnusedDeclared(imports, Object.keys(manifest.dependencies ?? {}));
  if (unused.length > 0) {
    console.error(`${manifest.name}: "dependencies" the bundle never imports (consumers install these for nothing):`);
    for (const name of unused) console.error(`  - ${name}`);
  }

  if (leakedInternals.length > 0 || undeclared.length > 0 || unused.length > 0) process.exit(1);

  console.log(`${manifest.name}: bundle self-contained (${imports.length} external specifiers, all declared, none unused)`);
}

// Only run the CLI when invoked directly, so the pure helpers stay importable.
if (process.argv[1]?.endsWith("verify-bundle.mjs")) {
  await main();
}
