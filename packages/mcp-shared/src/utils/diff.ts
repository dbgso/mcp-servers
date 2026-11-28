/**
 * Generic structure diff utility for comparing AST summaries.
 * Used by ast-typescript-mcp and ast-file-mcp for diff_structure tool.
 */

/**
 * Interface for items that can be compared in a structural diff.
 * Items are identified by a unique key and have a kind/type.
 */
export interface DiffableItem {
  /** Unique identifier for matching (e.g., name for declarations, text for headings) */
  key: string;
  /** Type/kind of the item (e.g., "function", "class", "heading") */
  kind: string;
  /** Line number in the source file */
  line: number;
  /** Additional properties for detailed comparison */
  properties?: Record<string, unknown>;
}

/**
 * Represents a single change in the diff.
 */
export interface DiffChange {
  /** The unique key of the changed item */
  key: string;
  /** The kind/type of the item */
  kind: string;
  /** Line number in file A (for removed/modified) */
  lineA?: number;
  /** Line number in file B (for added/modified) */
  lineB?: number;
  /** Details about what changed (for modified items) */
  details?: string;
}

/**
 * Result of comparing two structures.
 */
export interface DiffResult {
  /** Items that exist in B but not in A */
  added: DiffChange[];
  /** Items that exist in A but not in B */
  removed: DiffChange[];
  /** Items that exist in both but have differences */
  modified: DiffChange[];
  /** Human-readable summary of changes */
  summary: string;
}

/**
 * Options for diff comparison.
 */
export interface DiffOptions {
  /** Comparison level: summary (name+kind only) or detailed (includes properties) */
  level: "summary" | "detailed";
}

type ItemsByKey = Map<string, DiffableItem>;

/** An item under the same key on both sides, so it can only have been modified. */
interface ItemPair {
  itemA: DiffableItem;
  itemB: DiffableItem;
}

function indexByKey(items: DiffableItem[]): ItemsByKey {
  const byKey: ItemsByKey = new Map();
  for (const item of items) {
    byKey.set(item.key, item);
  }
  return byKey;
}

function addedItems(params: { mapA: ItemsByKey; mapB: ItemsByKey }): DiffChange[] {
  const { mapA, mapB } = params;
  const added: DiffChange[] = [];
  for (const [key, itemB] of mapB) {
    if (!mapA.has(key)) {
      added.push({ key, kind: itemB.kind, lineB: itemB.line });
    }
  }
  return added;
}

function removedItems(params: { mapA: ItemsByKey; mapB: ItemsByKey }): DiffChange[] {
  const { mapA, mapB } = params;
  const removed: DiffChange[] = [];
  for (const [key, itemA] of mapA) {
    if (!mapB.has(key)) {
      removed.push({ key, kind: itemA.kind, lineA: itemA.line });
    }
  }
  return removed;
}

function commonPairs(params: { mapA: ItemsByKey; mapB: ItemsByKey }): ItemPair[] {
  const { mapA, mapB } = params;
  const pairs: ItemPair[] = [];
  for (const [key, itemA] of mapA) {
    const itemB = mapB.get(key);
    if (itemB !== undefined) {
      pairs.push({ itemA, itemB });
    }
  }
  return pairs;
}

function kindChange(params: ItemPair): string | null {
  const { itemA, itemB } = params;
  if (itemA.kind === itemB.kind) return null;
  return `kind: ${itemA.kind} -> ${itemB.kind}`;
}

function lineChange(params: ItemPair): string | null {
  const { itemA, itemB } = params;
  if (itemA.line === itemB.line) return null;
  return `line: ${itemA.line} -> ${itemB.line}`;
}

/**
 * Both sides must carry properties: diffing against a missing set would report
 * every key as added or removed, which says nothing about the item itself.
 */
function propertyChanges(params: ItemPair): string | null {
  const { properties: propsA } = params.itemA;
  const { properties: propsB } = params.itemB;
  if (propsA === undefined || propsB === undefined) return null;
  return diffProperties({ propsA, propsB });
}

/**
 * A move and a property edit are only changes in detailed mode: a summary diff
 * deliberately treats an item that merely moved as unchanged.
 */
function detailedChanges(params: {
  itemA: DiffableItem;
  itemB: DiffableItem;
  options: DiffOptions;
}): (string | null)[] {
  const { itemA, itemB, options } = params;
  if (options.level !== "detailed") return [];
  return [lineChange({ itemA, itemB }), propertyChanges({ itemA, itemB })];
}

function describeChanges(params: {
  itemA: DiffableItem;
  itemB: DiffableItem;
  options: DiffOptions;
}): string | null {
  const { itemA, itemB, options } = params;
  const found = [kindChange({ itemA, itemB }), ...detailedChanges({ itemA, itemB, options })];
  const changes = found.filter((change): change is string => change !== null);
  if (changes.length === 0) return null;
  return changes.join("; ");
}

function modifiedItems(params: {
  mapA: ItemsByKey;
  mapB: ItemsByKey;
  options: DiffOptions;
}): DiffChange[] {
  const { mapA, mapB, options } = params;
  const modified: DiffChange[] = [];
  for (const { itemA, itemB } of commonPairs({ mapA, mapB })) {
    const details = describeChanges({ itemA, itemB, options });
    if (details !== null) {
      modified.push({
        key: itemA.key,
        kind: itemB.kind,
        lineA: itemA.line,
        lineB: itemB.line,
        details,
      });
    }
  }
  return modified;
}

function countPart(params: { label: string; items: DiffChange[] }): string[] {
  const { label, items } = params;
  if (items.length === 0) return [];
  return [`${label} ${items.length}`];
}

function summarise(params: {
  added: DiffChange[];
  removed: DiffChange[];
  modified: DiffChange[];
}): string {
  const { added, removed, modified } = params;
  const parts = [
    ...countPart({ label: "Added", items: added }),
    ...countPart({ label: "Removed", items: removed }),
    ...countPart({ label: "Modified", items: modified }),
  ];
  if (parts.length === 0) return "No changes";
  return parts.join(", ");
}

/**
 * Compare two lists of diffable items and return the structural differences.
 *
 * Algorithm:
 * 1. Build a map of items in A by key
 * 2. Build a map of items in B by key
 * 3. Items in B but not in A = added
 * 4. Items in A but not in B = removed
 * 5. Items in both = check for modifications (kind change, property changes)
 *
 * @param params.itemsA - Items from file A
 * @param params.itemsB - Items from file B
 * @param params.options - Comparison options
 * @returns Diff result with added, removed, modified items and summary
 */
export function diffStructures(params: {
  itemsA: DiffableItem[];
  itemsB: DiffableItem[];
  options?: DiffOptions;
}): DiffResult {
  const { itemsA, itemsB, options = { level: "summary" } } = params;
  const mapA = indexByKey(itemsA);
  const mapB = indexByKey(itemsB);

  const added = addedItems({ mapA, mapB });
  const removed = removedItems({ mapA, mapB });
  const modified = modifiedItems({ mapA, mapB, options });

  // Sort by line number, so the diff reads in the order of the file.
  //
  // `lineA` / `lineB` are optional on `DiffChange` because a consumer may build
  // one without them -- an added item has no line in A. Every change built
  // above has the one it is sorted on, so the reading is direct rather than
  // through a `?? 0` that could never be reached and implied the field might
  // be missing here.
  added.sort((a, b) => (a.lineB as number) - (b.lineB as number));
  removed.sort((a, b) => (a.lineA as number) - (b.lineA as number));
  modified.sort((a, b) => (a.lineB as number) - (b.lineB as number));

  return {
    added,
    removed,
    modified,
    summary: summarise({ added, removed, modified }),
  };
}

function onlyInB(params: { valueA: unknown; valueB: unknown }): boolean {
  return params.valueA === undefined && params.valueB !== undefined;
}

function onlyInA(params: { valueA: unknown; valueB: unknown }): boolean {
  return params.valueA !== undefined && params.valueB === undefined;
}

/**
 * A key only one side has is reported as gained or lost rather than as a value
 * change: there is no before-and-after to show for it.
 */
function presenceChange(params: { key: string; valueA: unknown; valueB: unknown }): string | null {
  const { key, valueA, valueB } = params;
  if (onlyInB({ valueA, valueB })) return `+${key}`;
  if (onlyInA({ valueA, valueB })) return `-${key}`;
  return null;
}

function valueChange(params: { key: string; valueA: unknown; valueB: unknown }): string | null {
  const { key, valueA, valueB } = params;
  if (JSON.stringify(valueA) === JSON.stringify(valueB)) return null;
  return `${key}: ${formatValue(valueA)} -> ${formatValue(valueB)}`;
}

function propertyChange(params: { key: string; valueA: unknown; valueB: unknown }): string | null {
  const presence = presenceChange(params);
  if (presence !== null) return presence;
  return valueChange(params);
}

/**
 * Compare two property objects and return a description of differences.
 */
function diffProperties(params: {
  propsA: Record<string, unknown>;
  propsB: Record<string, unknown>;
}): string | null {
  const { propsA, propsB } = params;
  const allKeys = new Set([...Object.keys(propsA), ...Object.keys(propsB)]);

  const changes = [...allKeys]
    .map((key) => propertyChange({ key, valueA: propsA[key], valueB: propsB[key] }))
    .filter((change): change is string => change !== null);

  if (changes.length === 0) return null;
  return changes.join(", ");
}

/** Long strings are truncated: a diff line reports that a value changed, not the value. */
const MAX_STRING_LENGTH = 20;

function formatString(value: string): string {
  if (value.length > MAX_STRING_LENGTH) return `"${value.slice(0, MAX_STRING_LENGTH)}..."`;
  return `"${value}"`;
}

/** Numbers and booleans read unambiguously bare; a string needs its quotes. */
function isBareScalar(value: unknown): boolean {
  return typeof value === "number" || typeof value === "boolean";
}

/** A collection is summarised by its shape, since its contents are not the point. */
function formatObject(value: object): string {
  if (Array.isArray(value)) return `[${value.length} items]`;
  return "{...}";
}

function formatComposite(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return formatOther(value);
  return formatObject(value);
}

/** What is left once strings, numbers, booleans, null and objects are handled. */
function formatOther(value: unknown): string {
  if (typeof value === "bigint" || typeof value === "symbol") return value.toString();
  return typeof value; // "undefined" or "function"
}

/**
 * Format a value for display in diff output.
 */
function formatValue(value: unknown): string {
  if (typeof value === "string") return formatString(value);
  if (isBareScalar(value)) return String(value);
  return formatComposite(value);
}
