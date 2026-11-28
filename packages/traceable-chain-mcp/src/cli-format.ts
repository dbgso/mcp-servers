import type { CheckReport, Document, DocumentSummary, Finding, ImpactReport, TraceNode } from "./types.js";

function label(doc: DocumentSummary): string {
  return `${doc.type} "${doc.title}" (${doc.id})`;
}

function formatFinding(f: Finding): string {
  return `  ${f.kind.padEnd(19)} ${f.type ? label(f) : f.id}\n  ${" ".repeat(19)} ${f.message}`;
}

function section(params: { title: string; lines: string[] }): string[] {
  if (params.lines.length === 0) return [];
  return ["", params.title, ...params.lines];
}

/** Human-readable `check` report: findings, then the walk up for each drifted document */
export function formatCheck(report: CheckReport): string {
  const status = report.ok ? "✓" : "✗";
  const errors = report.findings.filter(f => f.severity === "error");
  const warnings = report.findings.filter(f => f.severity === "warning");
  const walk = report.escalations.flatMap(e => [
    `  ${e.actionable ? "▶" : " "} ${label(e.document)}`,
    ...e.ancestors.map(a => `      ↑ ${label(a)}`),
  ]);
  return [
    `${status} ${report.errors} error(s), ${report.warnings} warning(s)`,
    ...section({ title: "Errors", lines: errors.map(formatFinding) }),
    ...section({ title: "Warnings", lines: warnings.map(formatFinding) }),
    ...section({ title: "Walk up (▶ = settle now: everything above it holds; work top-down)", lines: walk }),
  ].join("\n");
}

export function formatImpact(report: ImpactReport): string {
  const list = (docs: DocumentSummary[]) => docs.map(d => `  ${label(d)}`);
  return [
    "Subject",
    ...list(report.subjects),
    ...section({ title: "Must still satisfy (upstream, to the root)", lines: list(report.upstream) }),
    ...section({ title: "Can invalidate (downstream)", lines: list(report.downstream) }),
  ].join("\n");
}

export function formatTrace(node: TraceNode): string {
  return formatTraceAt({ node, depth: 0 });
}

function formatTraceAt(params: { node: TraceNode; depth: number }): string {
  const { node, depth } = params;
  const mark = node.suspect ? " ⚠" : "";
  const line = `${"  ".repeat(depth)}${depth > 0 ? "└ " : ""}${label(node)}${mark}`;
  return [line, ...node.children.map(child => formatTraceAt({ node: child, depth: depth + 1 }))].join("\n");
}

export function formatList(docs: Document[]): string {
  if (docs.length === 0) return "(no documents)";
  return docs.map(d => `${d.id}  ${d.type.padEnd(14)} ${d.title}`).join("\n");
}
