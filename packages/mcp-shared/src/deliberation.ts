/**
 * Deliberation gate -- `mcp-shared/deliberation`.
 *
 * A separate entry point from `mcp-shared/approval` for one reason: reaching
 * the gate must not drag the notifier in. The approval barrel re-exports
 * `core.ts`, which imports `node-notifier`, so a server that gates everything
 * on deliberation and owns no token flow still ended up with the notifier in
 * its bundle -- which is exactly what `mcp-interactive-instruction` set out to
 * remove, and what its bundle check caught.
 *
 * `contentHash` comes along because it is what a caller needs to build the
 * `what` the gate is keyed on, and it has no dependencies of its own.
 */

export {
  DeliberationGate,
  DEFAULT_REQUIRED_ATTEMPTS,
  DEFAULT_DELIBERATION_TTL_MS,
} from "./utils/approval/deliberation.js";

export type {
  DeliberationConfig,
  DeliberationRequest,
  DeliberationOutcome,
  DeliberationKey,
  RefusedOutcome,
} from "./utils/approval/deliberation.js";

export { contentHash } from "./utils/content-hash.js";
