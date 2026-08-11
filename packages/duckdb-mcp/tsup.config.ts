import { mcpBinConfig } from "../../scripts/tsup-bin-config.js";

// @duckdb/node-api ships per-platform .node binaries that esbuild cannot
// resolve for platforms it does not install, and this package genuinely uses
// it, so it stays a declared dependency and an external.
export default mcpBinConfig(import.meta.url, { external: ["@duckdb/node-api"] });
