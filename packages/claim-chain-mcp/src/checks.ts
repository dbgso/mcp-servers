/**
 * The checks. Each one is a property of ids and the kinds of what they cite,
 * never of what a field says.
 */

import { versionOf, type Claim, type Ref } from "./claim.js";
import type { FieldRule, KindRule, RefRule } from "./kinds.js";
import type { Snapshot } from "./store.js";

export type Severity = "error" | "warning";

export interface Finding {
  rule: string;
  severity: Severity;
  /** The claim or gap the finding is about. */
  id: string;
  message: string;
  /** For a `ref-count` shortfall: the kind that is missing upstream. */
  needs?: string;
}

/** What a claim says before it has an id: kind, fields, and the ids it cites. */
export interface Shape {
  id: string;
  kind: string;
  fields: Record<string, string>;
  refs: string[];
}

interface ShapeContext {
  shape: Shape;
  rule: KindRule;
  claims: Map<string, Claim>;
}

function error(params: { rule: string; id: string; message: string }): Finding {
  return { ...params, severity: "error" };
}

/** Everything wrong with one claim on its own: its kind, fields and citations. */
export function checkShape(params: {
  shape: Shape;
  kinds: Map<string, KindRule>;
  claims: Map<string, Claim>;
}): Finding[] {
  const { shape, kinds, claims } = params;
  const rule = kinds.get(shape.kind);
  if (rule === undefined) {
    return [
      error({
        rule: "unknown-kind",
        id: shape.id,
        message: `"${shape.kind}" is not a kind. Kinds: ${[...kinds.keys()].join(", ")}`,
      }),
    ];
  }

  const context = { shape, rule, claims };
  return [...checkFields(context), ...checkRefs(context)];
}

function checkFields(context: ShapeContext): Finding[] {
  const { shape, rule } = context;
  const allowed = new Set(rule.fields.map((field) => field.name));
  const unknown = Object.keys(shape.fields).filter((name) => !allowed.has(name));

  return [
    ...rule.fields.flatMap((field) => checkField({ shape, field })),
    ...unknown.map((name) =>
      error({
        rule: "unknown-field",
        id: shape.id,
        message: `${shape.kind} has no field "${name}". Its fields: ${[...allowed].join(", ")}`,
      })
    ),
  ];
}

function checkField(params: { shape: Shape; field: FieldRule }): Finding[] {
  const { shape, field } = params;
  const value = shape.fields[field.name] ?? "";
  if (value.trim() === "") {
    return [error({ rule: "missing-field", id: shape.id, message: `${shape.kind} needs the field "${field.name}"` })];
  }
  if (field.values === undefined || field.values.includes(value)) return [];

  return [
    error({
      rule: "invalid-field",
      id: shape.id,
      message: `"${field.name}" is "${value}"; it can only be ${field.values.join(" or ")}`,
    }),
  ];
}

function checkRefs(context: ShapeContext): Finding[] {
  const { shape, rule } = context;
  const cited = shape.refs.map((id) => citationOf({ id, context }));
  const findings = cited.flatMap((citation) => (citation.finding === undefined ? [] : [citation.finding]));

  for (const refRule of rule.refs) {
    const count = cited.filter((citation) => citation.kind === refRule.kind).length;
    findings.push(...checkCount({ shape, refRule, count }));
  }

  return findings;
}

/** One citation: the kind it counts towards, or why it counts towards none. */
function citationOf(params: { id: string; context: ShapeContext }): { kind?: string; finding?: Finding } {
  const { id, context } = params;
  const { shape, rule, claims } = context;
  const target = claims.get(id);
  if (target === undefined) {
    return { finding: error({ rule: "missing-ref", id: shape.id, message: `cites ${id}, which does not exist` }) };
  }
  if (!rule.refs.some((ref) => ref.kind === target.kind)) return { finding: wrongKind({ shape, rule, target }) };
  return { kind: target.kind };
}

function wrongKind(params: { shape: Shape; rule: KindRule; target: Claim }): Finding {
  const { shape, rule, target } = params;
  const kinds = rule.refs.map((ref) => ref.kind).join(", ");
  return error({
    rule: "wrong-kind",
    id: shape.id,
    message: `${shape.kind} cannot cite a ${target.kind} (${target.id}); it cites ${kinds || "nothing"}`,
  });
}

function checkCount(params: { shape: Shape; refRule: RefRule; count: number }): Finding[] {
  const { shape, refRule, count } = params;
  if (count < refRule.min) {
    return [
      {
        rule: "ref-count",
        severity: "error",
        id: shape.id,
        needs: refRule.kind,
        message: `${shape.kind} has to cite at least ${refRule.min} ${refRule.kind}; it cites ${count}`,
      },
    ];
  }
  if (refRule.max !== undefined && count > refRule.max) {
    return [
      error({
        rule: "ref-count",
        id: shape.id,
        message: `${shape.kind} can cite at most ${refRule.max} ${refRule.kind}; it cites ${count}. Split it`,
      }),
    ];
  }
  return [];
}

/** A stored claim as a shape, for checking it the way `add` checked it. */
export function shapeOf(claim: Claim): Shape {
  return { id: claim.id, kind: claim.kind, fields: claim.fields, refs: claim.refs.map((ref) => ref.id) };
}

/** The claims that cite `id`. */
export function citersOf(params: { id: string; claims: Map<string, Claim> }): Claim[] {
  return [...params.claims.values()].filter((claim) => claim.refs.some((ref) => ref.id === params.id));
}

function checkCoverage(params: { claim: Claim; rule: KindRule; claims: Map<string, Claim> }): Finding[] {
  const { claim, rule, claims } = params;
  if (rule.coveredBy === undefined) return [];

  const covered = citersOf({ id: claim.id, claims }).some((citer) => citer.kind === rule.coveredBy);
  if (covered) return [];

  return [
    error({
      rule: "uncovered",
      id: claim.id,
      message: `no ${rule.coveredBy} cites this ${claim.kind}, so nothing below it has been decided`,
    }),
  ];
}

/** The citations made against a version the cited claim no longer has. */
export function staleRefs(params: { claim: Claim; claims: Map<string, Claim> }): Ref[] {
  return params.claim.refs.filter((ref) => {
    const target = params.claims.get(ref.id);
    return target !== undefined && versionOf(target) !== ref.version;
  });
}

function checkStale(params: { claim: Claim; claims: Map<string, Claim> }): Finding[] {
  return staleRefs(params).map((ref) =>
    error({
      rule: "stale-ref",
      id: params.claim.id,
      message: `cites ${ref.id} as it was (${ref.version}); it has changed since. Check this claim still holds, then update its refs`,
    })
  );
}

/** Every check over everything under a root. */
export function checkAll(params: { snapshot: Snapshot; kinds: Map<string, KindRule> }): Finding[] {
  const { snapshot, kinds } = params;
  const { claims } = snapshot;
  const findings: Finding[] = [];

  for (const claim of claims.values()) {
    findings.push(...checkShape({ shape: shapeOf(claim), kinds, claims }));
    findings.push(...checkStale({ claim, claims }));
    const rule = kinds.get(claim.kind);
    if (rule !== undefined) findings.push(...checkCoverage({ claim, rule, claims }));
  }

  for (const gap of snapshot.gaps.values()) {
    if (gap.status !== "open") continue;
    findings.push({
      rule: "open-gap",
      severity: "warning",
      id: gap.id,
      message: `a ${gap.needs} is missing: ${gap.want}`,
    });
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "No findings.";
  return findings
    .map((finding) => `- ${finding.severity === "error" ? "✗" : "⚠"} ${finding.id} [${finding.rule}] ${finding.message}`)
    .join("\n");
}
