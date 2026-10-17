/**
 * The version this server reports over MCP.
 *
 * Replaced with a string literal at build time by tsup's `define`, so what a
 * consumer sees always matches the package they installed -- including the
 * `0.0.0-<tag>.<timestamp>.<sha>` snapshots, where a hardcoded version would
 * make it impossible to tell which build is running.
 *
 * The guard is for the unbundled paths: `tsx src/index.ts` and vitest run the
 * source directly, where no bundler has substituted anything.
 */
declare const __PKG_VERSION__: string | undefined;

export const VERSION: string = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0-dev";
