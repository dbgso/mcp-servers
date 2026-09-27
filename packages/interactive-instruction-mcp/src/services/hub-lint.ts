/**
 * A hub and the documents under it, checked from both ends.
 *
 * `every-task` used to name five `workflow__*` rules one by one. #81 removed
 * them by hand and wrote the reason into the document it was editing: "this
 * file naming each rule is how the list and the directory come to disagree
 * about what exists." Naming a cause in prose and leaving nothing that can
 * detect it is the state `policy__criterion-before-detection` is about -- the
 * next document to do the same thing gets no warning at all. So this is that
 * cause, detected.
 *
 * Two rules, because the drift has two ends. A document can point at the
 * children instead of the hub (`prefer-hub-reference`), and the hub's own list
 * can stop matching what is under it (`stale-hub-index`). The second is the
 * worse one: moving everyone to "read the hub" stakes the whole corpus on the
 * hub being right, and until now nothing looked.
 */

import type { LintIssue } from "./document-lint.js";

/** What separates a child id from the id of its parent. */
const ID_SEPARATOR = "__";

/**
 * The names a hub gets called when it is put in the wrong place.
 *
 * A file named `overview.md` inside the family's directory reads as the index of
 * it, and is one in every way except the one that counts: the id hierarchy makes
 * `coding-rules__overview` a sibling of what it indexes, so nothing can tell it
 * apart from its own subject matter.
 */
const HUB_ALIASES = new Set(["overview", "index", "readme"]);

/**
 * One reference to a child is a cross-reference; two is an index.
 *
 * A document that cites a single rule is pointing at that rule, and sending it
 * to the hub instead would lose which one it meant. It is the second that turns
 * the passage into a list, and a list is the thing that goes stale.
 *
 * Two is also where this corpus sits on the edge: a design document citing the
 * two coding rules it has to satisfy is cited, not indexed, and it is reported
 * here all the same. Which of those a corpus has more of is a property of the
 * corpus, not something to argue about -- so it is a number a corpus can set.
 */
const DEFAULT_MIN_CHILDREN = 2;

/** Below two documents there is no family to index and nothing to go stale. */
const MIN_SIBLINGS_FOR_HUB = 2;

/**
 * `IIMCP_LINT_HUB_CHILDREN`, the number of children from one family a document
 * may name before it is treated as keeping an index of them. Below 2 every
 * single reference is an index, which is not a rule anyone would want, so an
 * unusable value falls back rather than throwing.
 */
export function configuredMinChildren(): number {
  const raw = process.env.IIMCP_LINT_HUB_CHILDREN;
  if (raw === undefined) return DEFAULT_MIN_CHILDREN;

  const parsed = Number(raw);
  return usableThreshold(parsed) ? parsed : DEFAULT_MIN_CHILDREN;
}

function usableThreshold(parsed: number): boolean {
  return Number.isInteger(parsed) && parsed >= DEFAULT_MIN_CHILDREN;
}

export interface HubDocument {
  id: string;
  relatedDocs?: string[];
  content: string;
}

/** `workflow__constraint-ladder` -> `workflow`. A top-level id has no parent. */
export function parentIdOf(id: string): string | null {
  const at = id.lastIndexOf(ID_SEPARATOR);
  if (at < 1) return null;
  return id.slice(0, at);
}

/** The part of an id after its parent, or the whole id when it has no parent. */
function lastSegment(id: string): string {
  const parent = parentIdOf(id);
  if (parent === null) return id;
  return id.slice(parent.length + ID_SEPARATOR.length);
}

/**
 * An id written in the body, as opposed to one that merely appears inside a
 * longer word.
 *
 * Only ids carrying the separator are ever looked for. A hub is named for what
 * it is about -- `policy`, `workflow` -- and those are ordinary English words
 * that appear in prose about something else entirely; searching for them would
 * report a sentence as a reference.
 */
function mentions(params: { content: string; id: string }): boolean {
  const { content, id } = params;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(content);
}

/**
 * Every document this one points at, however it points.
 *
 * `relatedDocs` and the prose count the same. The list in `every-task` was
 * written as `See \`workflow__dry-principle\`` in the body, and a rule that
 * read only the frontmatter would have called that document clean.
 */
export function referencesOf(params: { doc: HubDocument; candidates: string[] }): Set<string> {
  const { doc, candidates } = params;
  const named = doc.relatedDocs ?? [];
  const mentioned = candidates.filter((id) => mentions({ content: doc.content, id }));
  return new Set([...named, ...mentioned].filter((id) => id !== doc.id));
}

/** The ids worth searching the prose for: the ones that name a parent. */
export function childCandidates(ids: string[]): string[] {
  return ids.filter((id) => parentIdOf(id) !== null);
}

/** Appends without needing the key to be there already. */
function addChild(params: { groups: Map<string, string[]>; parent: string; id: string }): void {
  const { groups, parent, id } = params;
  const siblings = groups.get(parent) ?? [];
  groups.set(parent, [...siblings, id]);
}

function groupByHub(referenced: Set<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const id of referenced) {
    const parent = parentIdOf(id);
    if (parent === null) continue;
    addChild({ groups, parent, id });
  }

  return groups;
}

/**
 * Whether the hub is there to be pointed at.
 *
 * The rule has to fire either way, and finding that out is what this check was
 * missing at first: when `every-task` listed five `workflow__*` rules there was
 * no `workflow` document at all, so a rule that only spoke up once the hub
 * existed would have stayed silent through the entire case it was written for.
 * A family with no hub is the worse of the two -- the scattered list is then
 * the only index of it anywhere.
 */
function hubAdvice(params: { hub: string; exists: boolean }): string {
  const { hub, exists } = params;
  if (exists) {
    return `Point at "${hub}" instead of its children.`;
  }
  return (
    `No "${hub}" document exists, so this list is the only index of that family ` +
    "anywhere. Write the hub and point at it."
  );
}

function hubIssue(params: { docId: string; hub: string; children: string[]; exists: boolean }): LintIssue {
  const { docId, hub, children, exists } = params;
  return {
    severity: "warning",
    docId,
    rule: "prefer-hub-reference",
    message:
      `Names ${children.length} documents under "${hub}" (${children.join(", ")}). ` +
      hubAdvice({ hub, exists }) +
      " A list repeated outside the hub is a second copy of the index, and it is the copy " +
      "that stops matching the directory when a document is added or renamed.",
  };
}

/**
 * A document that indexes someone else's children.
 *
 * The hub is allowed to list its own -- that is what it is for -- and so is a
 * sibling: `workflow__constraint-ladder` citing two other workflow rules is
 * cross-referencing within a family it belongs to, not keeping an index of it.
 */
export function checkPrefersHub(params: {
  doc: HubDocument;
  referenced: Set<string>;
  hubs: Set<string>;
}): LintIssue[] {
  const { doc, referenced, hubs } = params;
  const ownParent = parentIdOf(doc.id);
  const groups = groupByHub(referenced);

  return [...groups.entries()]
    .filter(([hub]) => hub !== doc.id && hub !== ownParent)
    .filter(([, children]) => children.length >= configuredMinChildren())
    .map(([hub, children]) => hubIssue({ docId: doc.id, hub, children, exists: hubs.has(hub) }));
}

function missingChildrenIssue(params: { docId: string; missing: string[] }): LintIssue {
  const { docId, missing } = params;
  return {
    severity: "warning",
    docId,
    rule: "stale-hub-index",
    message:
      `${missing.length} document(s) sit under this one but it does not reference them ` +
      `(${missing.join(", ")}). Everything else is told to read the hub rather than the ` +
      "directory, so a child the hub leaves out is a document nobody is sent to.",
  };
}

function unknownChildrenIssue(params: { docId: string; unknown: string[] }): LintIssue {
  const { docId, unknown } = params;
  return {
    severity: "warning",
    docId,
    rule: "stale-hub-index",
    message:
      `References ${unknown.length} document(s) under this one that do not exist ` +
      `(${unknown.join(", ")}). A renamed or removed child leaves the hub pointing at ` +
      "nothing, and the reader who follows it finds nothing rather than the new name.",
  };
}

/**
 * A hub against the documents actually under it, in both directions.
 *
 * Children it never names, and names with no child behind them. Both are the
 * index having been written by hand, which is the only way it is ever written.
 */
export function checkHubIndex(params: {
  hub: HubDocument;
  children: string[];
  referenced: Set<string>;
}): LintIssue[] {
  const { hub, children, referenced } = params;
  const known = new Set(children);

  const missing = children.filter((id) => !referenced.has(id));
  const unknown = [...referenced].filter(
    (id) => parentIdOf(id) === hub.id && !known.has(id),
  );

  return [
    ...(missing.length > 0 ? [missingChildrenIssue({ docId: hub.id, missing })] : []),
    ...(unknown.length > 0 ? [unknownChildrenIssue({ docId: hub.id, unknown })] : []),
  ];
}

function misplacedHubIssue(params: { docId: string; parent: string; siblings: number }): LintIssue {
  const { docId, parent, siblings } = params;
  return {
    severity: "warning",
    docId,
    rule: "misplaced-hub",
    message:
      `One of the ${siblings} documents under "${parent}", and named as their index. ` +
      `The hub is the document at "${parent}": at this id it is a sibling of its own ` +
      "subject matter, so a reference to it does not count as a reference to the family, " +
      "nothing checks its list against the directory, and the family still has no hub. " +
      `Rename it to "${parent}".`,
  };
}

function siblingCount(params: { parent: string; families: Map<string, string[]> }): number {
  return (params.families.get(params.parent) ?? []).length;
}

function familyNeedsHub(params: {
  parent: string;
  hubs: Set<string>;
  families: Map<string, string[]>;
}): boolean {
  return !params.hubs.has(params.parent) && siblingCount(params) >= MIN_SIBLINGS_FOR_HUB;
}

function isMisplacedHub(params: {
  id: string;
  parent: string;
  hubs: Set<string>;
  families: Map<string, string[]>;
}): boolean {
  return HUB_ALIASES.has(lastSegment(params.id).toLowerCase()) && familyNeedsHub(params);
}

/**
 * An index that lives inside what it indexes.
 *
 * Neither of the other two rules reaches this. `stale-hub-index` needs a document
 * at the family's id to check, and there is none -- that is the defect -- so the
 * list goes unchecked however wrong it gets. This repository's own
 * `coding-rules__overview` named 14 of 18 documents and one that does not exist,
 * and nothing said so.
 *
 * Found by writing down what a hub is, which is the order that was skipped the
 * first time: the detection was built before the criterion, and it could only
 * detect the cases the criterion had not yet been written to cover.
 */
export function checkMisplacedHub(params: {
  doc: HubDocument;
  hubs: Set<string>;
  families: Map<string, string[]>;
}): LintIssue[] {
  const { doc, hubs, families } = params;
  const parent = parentIdOf(doc.id);
  if (parent === null) return [];

  return isMisplacedHub({ id: doc.id, parent, hubs, families })
    ? [misplacedHubIssue({ docId: doc.id, parent, siblings: siblingCount({ parent, families }) })]
    : [];
}

/** The children of each id that has any, so a hub is an id this map contains. */
export function childrenByParent(ids: string[]): Map<string, string[]> {
  const families = new Map<string, string[]>();

  for (const id of ids) {
    const parent = parentIdOf(id);
    if (parent === null) continue;
    addChild({ groups: families, parent, id });
  }

  return families;
}
