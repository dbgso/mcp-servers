import { hashDocument } from "../hash.js";
import type { ChainGraph } from "../graph.js";
import { parentIds } from "../graph.js";
import type { ChainConfig, Document, Finding, FindingKind, Severity } from "../types.js";

/** Everything a rule needs besides the document it is looking at */
export interface RuleContext {
  config: ChainConfig;
  graph: ChainGraph;
  /** Current hash of the code a reference covers, null when it covers nothing */
  hashCode: (pattern: string) => string | null;
}

/**
 * One mechanical check. Each rule looks at one document and reports what it
 * finds; `check` runs every rule over every document.
 */
export interface Rule {
  check(doc: Document, ctx: RuleContext): Finding[];
}

function finding(params: {
  doc: Document;
  kind: FindingKind;
  severity: Severity;
  message: string;
  parentId?: string;
  path?: string;
}): Finding {
  const { doc, ...rest } = params;
  return { id: doc.id, type: doc.type, title: doc.title, ...rest };
}

function allowedParentTypes(requires: string | string[]): string[] {
  if (Array.isArray(requires)) return requires;
  return [requires];
}

/** The type must be one the config knows */
export class UnknownTypeRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    if (doc.type in ctx.config.types) return [];
    return [finding({ doc, kind: "unknown_type", severity: "error", message: `Unknown type: "${doc.type}"` })];
  }
}

/**
 * Parents must exist and be of an allowed type; a root type has none and a
 * non-root type has at least one.
 */
export class ParentRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    const typeConfig = ctx.config.types[doc.type];
    if (!typeConfig) return [];
    const parents = parentIds(doc);
    // A root type is where decisions start, so nothing may sit above it
    if (typeConfig.requires === null) {
      if (parents.length === 0) return [];
      return [finding({ doc, kind: "root_has_parent", severity: "error", message: `Type "${doc.type}" is a root type and should not have a parent` })];
    }
    const allowed = allowedParentTypes(typeConfig.requires);
    if (parents.length === 0) {
      return [finding({ doc, kind: "missing_parent", severity: "error", message: `Type "${doc.type}" requires a parent of type: ${allowed.join(" or ")}` })];
    }
    return parents.flatMap(pid => this.checkParent({ doc, pid, allowed, graph: ctx.graph }));
  }

  private checkParent(params: { doc: Document; pid: string; allowed: string[]; graph: ChainGraph }): Finding[] {
    const { doc, pid, allowed, graph } = params;
    const parent = graph.get(pid);
    if (!parent) {
      return [finding({ doc, kind: "parent_not_found", severity: "error", parentId: pid, message: `Parent document "${pid}" not found` })];
    }
    if (allowed.includes(parent.type)) return [];
    return [finding({
      doc,
      kind: "invalid_parent_type",
      severity: "error",
      parentId: pid,
      message: `Parent document "${pid}" has type "${parent.type}", but type "${doc.type}" requires: ${allowed.join(" or ")}`,
    })];
  }
}

/** Following parents must never come back around */
export class CycleRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    if (!ctx.graph.isInCycle(doc)) return [];
    return [finding({ doc, kind: "cycle", severity: "error", message: "Document is part of a dependency cycle" })];
  }
}

/**
 * Each link was confirmed against a particular version of both ends. When
 * either end has changed since, the link is suspect until someone confirms
 * the child still holds, or changes it.
 */
export class LinkDriftRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    const selfHash = hashDocument(doc);
    return parentIds(doc).flatMap(pid => {
      const parent = ctx.graph.get(pid);
      if (!parent) return [];
      return this.checkLink({ doc, parent, selfHash });
    });
  }

  private checkLink(params: { doc: Document; parent: Document; selfHash: string }): Finding[] {
    const { doc, parent, selfHash } = params;
    const baseline = doc.baseline?.[parent.id];
    if (!baseline) {
      return [finding({ doc, kind: "unreviewed_link", severity: "error", parentId: parent.id, message: `Link to ${parent.type} "${parent.title}" has never been confirmed` })];
    }
    const results: Finding[] = [];
    // The decision above moved: does this document still follow from it?
    if (baseline.parent !== hashDocument(parent)) {
      results.push(finding({ doc, kind: "parent_changed", severity: "error", parentId: parent.id, message: `${parent.type} "${parent.title}" changed after this link was confirmed` }));
    }
    // This document moved: does it still satisfy the decision above?
    if (baseline.self !== selfHash) {
      results.push(finding({ doc, kind: "self_changed", severity: "error", parentId: parent.id, message: `Changed after its link to ${parent.type} "${parent.title}" was confirmed; check it still satisfies it` }));
    }
    return results;
  }
}

/** Code a document points at must still be what it was when confirmed */
export class CodeDriftRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    return (doc.code ?? []).flatMap(ref => {
      const current = ctx.hashCode(ref.path);
      if (current === null) {
        return [finding({ doc, kind: "code_missing", severity: "error", path: ref.path, message: `Code path "${ref.path}" matches no files` })];
      }
      if (ref.hash === undefined) {
        return [finding({ doc, kind: "code_unreviewed", severity: "error", path: ref.path, message: `Code path "${ref.path}" has never been confirmed` })];
      }
      if (ref.hash === current) return [];
      return [finding({ doc, kind: "code_changed", severity: "error", path: ref.path, message: `Code under "${ref.path}" changed after it was confirmed against this document` })];
    });
  }
}

/** A type that binds code should point at some */
export class NoCodeRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    if (!ctx.config.types[doc.type]?.bindsCode) return [];
    if ((doc.code ?? []).length > 0) return [];
    return [finding({ doc, kind: "no_code", severity: "warning", message: `${doc.type} is not bound to any code` })];
  }
}

/** A decision whose type expects a realization should have one below it */
export class UnrealizedRule implements Rule {
  check(doc: Document, ctx: RuleContext): Finding[] {
    const realizedBy = ctx.config.types[doc.type]?.realizedBy;
    if (!realizedBy) return [];
    if (ctx.graph.children(doc.id).some(child => child.type === realizedBy)) return [];
    return [finding({ doc, kind: "unrealized", severity: "warning", message: `No ${realizedBy} realizes this ${doc.type} yet` })];
  }
}

export const DEFAULT_RULES: Rule[] = [
  new UnknownTypeRule(),
  new ParentRule(),
  new CycleRule(),
  new LinkDriftRule(),
  new CodeDriftRule(),
  new NoCodeRule(),
  new UnrealizedRule(),
];

/** Finding kinds that mean "something changed and a person has to look" */
export const DRIFT_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>([
  "unreviewed_link",
  "parent_changed",
  "self_changed",
  "code_changed",
  "code_missing",
  "code_unreviewed",
]);

/** Finding kinds about a document's links upward, which block confirming anything below it */
export const UPWARD_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>([
  "unknown_type",
  "root_has_parent",
  "missing_parent",
  "parent_not_found",
  "invalid_parent_type",
  "cycle",
  "unreviewed_link",
  "parent_changed",
  "self_changed",
]);
