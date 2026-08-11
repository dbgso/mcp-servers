import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";
import type { Options } from "tsup";

/**
 * Shared tsup config for a publishable MCP bin.
 *
 * Every such package bundles the same way and for the same reason: the
 * workspace-internal `mcp-shared*` libraries are never published, so a `tsc`
 * build would ship a manifest depending on packages that do not exist on the
 * registry. Inlining them is the fix, and the shape of that fix does not vary
 * per package -- so it lives here rather than in eleven copies.
 *
 * @param configUrl `import.meta.url` of the calling package's tsup.config.ts,
 *   used to locate its package.json.
 * @param overrides package-specific additions, currently only `external` (a
 *   dependency the bundler must not try to resolve, e.g. a native module).
 */
export function mcpBinConfig(configUrl: string, overrides: Pick<Options, "external"> = {}) {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", configUrl), "utf8")) as {
    version: string;
  };

  return defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["esm"],
    platform: "node",
    target: "node18",
    // Inline the internal shared libraries; everything the package declares in
    // `dependencies` stays external (tsup's default) so consumers dedupe it.
    noExternal: [/^mcp-shared/],
    // node-notifier is reachable from mcp-shared's core barrel (the approval
    // flow runs through the describe/execute factory), but almost no bin
    // actually calls it. Left to be inlined it is worse than unused: it is
    // CommonJS, and its top-level `require("os")` cannot be shaken out of an
    // ESM bundle, so the binary dies on startup with "Dynamic require of "os"
    // is not supported". External, it tree-shakes away cleanly -- and if a bin
    // genuinely uses it the import survives and verify-bundle demands it be
    // declared.
    external: ["node-notifier", ...(overrides.external ?? [])],
    // Stamp the real version in at build time. Reading package.json at runtime
    // would resolve relative to the module's own location -- exactly what
    // bundling moves.
    define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
    // The verifier reads this instead of grepping the bundle text, where a
    // string literal containing `from "x"` reads as an import.
    metafile: true,
    sourcemap: true,
    clean: true,
  });
}
