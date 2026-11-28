import type { ChainGraph } from "../graph.js";
import { summarize } from "../graph.js";
import type { CheckReport, Document, Escalation, Finding } from "../types.js";
import type { Rule, RuleContext } from "./rules.js";
import { DEFAULT_RULES, DRIFT_KINDS, UPWARD_KINDS } from "./rules.js";

/**
 * Run every rule over every document and say, for each document that drifted,
 * what above it has to be re-read.
 */
export function runCheck(params: {
  ctx: RuleContext;
  invalidFiles?: { filePath: string; error: string }[];
  rules?: Rule[];
}): CheckReport {
  const { ctx, invalidFiles = [], rules = DEFAULT_RULES } = params;
  const findings: Finding[] = [
    ...invalidFiles.map(toInvalidFileFinding),
    ...ctx.graph.documents.flatMap(doc => rules.flatMap(rule => rule.check(doc, ctx))),
  ];
  const errors = findings.filter(f => f.severity === "error").length;
  return {
    ok: errors === 0,
    errors,
    warnings: findings.length - errors,
    findings,
    escalations: buildEscalations({ graph: ctx.graph, findings }),
  };
}

function toInvalidFileFinding(file: { filePath: string; error: string }): Finding {
  return {
    kind: "invalid_file",
    severity: "error",
    id: file.filePath,
    type: "",
    title: "",
    message: `Cannot parse document: ${file.error}`,
  };
}

/** IDs of documents whose own upward links are unresolved */
export function blockedIds(findings: Finding[]): Set<string> {
  return new Set(findings.filter(f => UPWARD_KINDS.has(f.kind)).map(f => f.id));
}

/**
 * The nearest ancestor that is still unresolved, or undefined when everything
 * above `doc` is settled. Resolution goes top-down, so this is what blocks
 * confirming `doc`.
 */
export function findBlockingAncestor(params: { graph: ChainGraph; doc: Document; findings: Finding[] }): Document | undefined {
  const { graph, doc, findings } = params;
  const blocked = blockedIds(findings);
  const ancestors = graph.ancestors(doc);
  // The topmost one is what to work on first
  return ancestors.reverse().find(a => blocked.has(a.id));
}

function buildEscalations(params: { graph: ChainGraph; findings: Finding[] }): Escalation[] {
  const { graph, findings } = params;
  // A broken link upward needs a decision just like drift does, so it is escalated too
  const driftIds = [...new Set(findings.filter(f => DRIFT_KINDS.has(f.kind) || UPWARD_KINDS.has(f.kind)).map(f => f.id))];
  return driftIds
    .map(id => graph.get(id))
    .filter((doc): doc is Document => doc !== undefined)
    .map(doc => ({
      document: summarize(doc),
      ancestors: graph.ancestors(doc).map(summarize),
      actionable: findBlockingAncestor({ graph, doc, findings }) === undefined,
    }));
}
