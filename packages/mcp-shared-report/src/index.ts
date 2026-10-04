/**
 * mcp-shared-report
 *
 * Give it a structured report, get back either every way it falls short or a
 * single-file HTML page. Pure: it writes nothing, and where the page goes is
 * the caller's business.
 */
export type {
  ActionAsk,
  Aside,
  Ask,
  Change,
  Claim,
  Correction,
  DecisionAsk,
  Decision,
  DecisionOption,
  Evidence,
  Impact,
  ImpactTarget,
  Problem,
  Recommendation,
  Remaining,
  Report,
  ValidationResult,
} from "./types.js";
export { CRITERIA } from "./criteria.js";
export type { Criterion } from "./criteria.js";
export { formatProblems, validateReport } from "./validate.js";
export { renderHtml } from "./renderers/html/index.js";
