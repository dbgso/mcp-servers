/**
 * Engine-strategy dispatcher.
 *
 * Iterates registered strategies and returns the first one whose `matches`
 * predicate accepts the URL. Adding a new engine is a one-line registry
 * append — the dispatcher itself stays engine-agnostic.
 */
import { postgresStrategy } from "./pg.js";
import { mysqlStrategy } from "./mysql.js";
import type { EngineStrategy } from "./types.js";

export const ENGINE_STRATEGIES: readonly EngineStrategy[] = [
  postgresStrategy,
  mysqlStrategy,
];

export function pickEngineStrategy(url: string): EngineStrategy {
  const strategy = ENGINE_STRATEGIES.find((s) => s.matches(url));
  if (!strategy) {
    throw new Error(
      `Unsupported DB URL scheme for db-read-mcp: ${redactUrl(url)} (supported: ${ENGINE_STRATEGIES.map((s) => s.engine).join(", ")})`,
    );
  }
  return strategy;
}

/** Strip credentials from the URL before echoing it back in an error message. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host || "<no host>";
    const scheme = parsed.protocol.replace(":", "") || "<no scheme>";
    return `${scheme}://${host}`;
  } catch {
    // URL parsing failed (e.g. truly malformed string) — show the scheme
    // prefix only so secrets don't leak into the error.
    const colon = url.indexOf(":");
    return colon > 0 ? `${url.slice(0, colon)}://...` : "<unparseable>";
  }
}
