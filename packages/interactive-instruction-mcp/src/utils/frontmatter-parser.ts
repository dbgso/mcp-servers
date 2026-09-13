/**
 * Frontmatter reading and writing.
 *
 * The rule here is that a write touches what it was asked to touch and nothing
 * else. That sounds obvious, and the previous implementation broke it three
 * ways: a hand-rolled line parser recognised seven keys and dropped everything
 * else, the serialiser rebuilt the block from a typed struct in a fixed order,
 * and neither understood quoting. So adding one `relatedDocs` entry to a
 * document deleted its `owner` and `ticket` keys, discarded its comments and
 * blank lines, reordered what was left, and let `"quoted values"` carry their
 * own quote marks into search results.
 *
 * None of it was recoverable: `link_remove` puts back the link, not the
 * `owner` key that went with it.
 *
 * The fix is to stop reconstructing the block. `yaml`'s Document API keeps the
 * parsed source -- comments, order, spacing, quoting style -- and edits it in
 * place, so anything this code has no opinion about survives a write. The typed
 * view of the known keys is still what callers see; it is just no longer what
 * gets written back.
 */

import { isMap, isSeq, parseDocument, Scalar, type Document } from "yaml";
import type { DocumentFrontmatter } from "../types/index.js";

// Standard frontmatter at file start
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

const WHEN_TO_USE_KEY = "whenToUse" as const;
const RELATED_DOCS_KEY = "relatedDocs" as const;
const STATUS_KEY = "status" as const;
const SELF_REVIEW_NOTES_KEY = "selfReviewNotes" as const;
const CONFIRMED_AT_KEY = "confirmedAt" as const;
const APPROVED_AT_KEY = "approvedAt" as const;

const VALID_STATUSES = [
  "editing",
  "self_review",
  "user_reviewing",
  "pending_approval",
  "approved",
] as const;

function frontmatterText(content: string): string | null {
  const match = content.match(FRONTMATTER_REGEX);
  return match === null ? null : match[1];
}

/**
 * Parse the frontmatter for reading, keeping whatever is legible.
 *
 * Malformed YAML is not rejected outright. `yaml` reports the error and still
 * hands back the keys it managed to resolve, and the line parser this replaced
 * was similarly forgiving -- it skipped junk lines and kept going. A document
 * with one stray line should still show its description in `list`, not vanish
 * from the corpus.
 */
function parseFrontmatterDocument(content: string): Document.Parsed | null {
  const text = frontmatterText(content);
  if (text === null) return null;
  return parseDocument(text);
}

/**
 * Parse the frontmatter for writing, and only when it is sound.
 *
 * Reading tolerates damage; writing must not. Editing a document `yaml` could
 * not fully understand would serialise back whatever it guessed -- in the
 * malformed case above it folds three lines into one invented key -- and that
 * guess would replace the file. Better to start from an empty block and lose
 * the unreadable metadata than to rewrite it into something new.
 */
function parseFrontmatterForWrite(content: string): Document.Parsed | null {
  const doc = parseFrontmatterDocument(content);
  if (doc === null || doc.errors.length > 0) return null;
  return doc;
}

/** A YAML scalar as a string, or undefined for anything else. */
function readString(params: { doc: Document.Parsed; key: string }): string | undefined {
  const value = params.doc.get(params.key);
  return typeof value === "string" ? value : undefined;
}

/**
 * A sequence of strings. Non-string entries are dropped rather than
 * stringified: `relatedDocs: [1, 2]` is a malformed link list, and inventing
 * `"1"` from it would name a document that cannot exist.
 */
function readStringArray(params: { doc: Document.Parsed; key: string }): string[] | undefined {
  const { doc, key } = params;
  // `get` hands back the node, not a plain array -- the whole point of the
  // Document API is that the node keeps its source. `toJSON` is what turns it
  // into the values callers expect.
  const node = doc.get(key);

  if (isSeq(node)) {
    const items: unknown = node.toJSON();
    if (!Array.isArray(items)) return undefined;
    return items.filter((item): item is string => typeof item === "string");
  }

  // A bare scalar reads as a one-item list. Documents written by hand carry
  // `whenToUse: single trigger`, and the previous parser accepted it; rejecting
  // it now would silently empty those fields.
  const value = doc.get(key);
  return typeof value === "string" ? [value] : undefined;
}

export function parseFrontmatter(content: string): DocumentFrontmatter {
  const doc = parseFrontmatterDocument(content);
  if (doc === null || !isMap(doc.contents)) return {};

  const result: DocumentFrontmatter = {};

  const description = readString({ doc, key: "description" });
  if (description !== undefined) result.description = description;

  const whenToUse = readStringArray({ doc, key: WHEN_TO_USE_KEY });
  if (whenToUse !== undefined) result.whenToUse = whenToUse;

  const relatedDocs = readStringArray({ doc, key: RELATED_DOCS_KEY });
  if (relatedDocs !== undefined) result.relatedDocs = relatedDocs;

  const status = readString({ doc, key: STATUS_KEY });
  if (status !== undefined && (VALID_STATUSES as readonly string[]).includes(status)) {
    result.status = status as DocumentFrontmatter["status"];
  }

  const selfReviewNotes = readString({ doc, key: SELF_REVIEW_NOTES_KEY });
  if (selfReviewNotes !== undefined) result.selfReviewNotes = selfReviewNotes;

  const confirmedAt = readString({ doc, key: CONFIRMED_AT_KEY });
  if (confirmedAt !== undefined) result.confirmedAt = confirmedAt;

  const approvedAt = readString({ doc, key: APPROVED_AT_KEY });
  if (approvedAt !== undefined) result.approvedAt = approvedAt;

  return result;
}

/**
 * Remove frontmatter from content and return the body
 */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_REGEX, "").trim();
}

/**
 * Create or update frontmatter in content.
 *
 * `content` is not only the source of the body: its frontmatter is the base the
 * new values are written onto, which is how everything outside
 * `DocumentFrontmatter` survives a write.
 */
export function updateFrontmatter(params: {
  content: string;
  frontmatter: DocumentFrontmatter;
}): string {
  const { content, frontmatter } = params;
  const body = stripFrontmatter(content);

  const parsed = parseFrontmatterForWrite(content);
  const doc = parsed !== null && isMap(parsed.contents) ? parsed : emptyDocument();

  applyField({ doc, key: "description", value: frontmatter.description });
  applyField({ doc, key: WHEN_TO_USE_KEY, value: nonEmpty(frontmatter.whenToUse) });
  applyField({ doc, key: RELATED_DOCS_KEY, value: nonEmpty(frontmatter.relatedDocs) });
  applyField({ doc, key: STATUS_KEY, value: frontmatter.status });
  applyField({ doc, key: SELF_REVIEW_NOTES_KEY, value: frontmatter.selfReviewNotes });
  applyField({ doc, key: CONFIRMED_AT_KEY, value: frontmatter.confirmedAt });
  applyField({ doc, key: APPROVED_AT_KEY, value: frontmatter.approvedAt });

  // An empty mapping stringifies as `{}`, which is valid YAML but reads as
  // noise in a document that simply has no metadata. Emit an empty block, as
  // the previous serialiser did.
  const yaml = isMap(doc.contents) && doc.contents.items.length === 0
    ? "\n"
    : doc.toString({ lineWidth: 0 });
  return `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n\n${body}`;
}

/**
 * A document to write into when there is no frontmatter to preserve.
 *
 * Built from `{}` because an empty source parses to null contents, with nowhere
 * for `set` to put anything -- then forced back to block style, since the flow
 * mapping `{}` would otherwise keep its braces and emit
 * `{ description: ..., whenToUse: [...] }` on one line.
 */
function emptyDocument(): Document {
  const doc = parseDocument("{}");
  if (isMap(doc.contents)) doc.contents.flow = false;
  return doc;
}

/** An empty array means "no value", matching how the old serialiser behaved. */
function nonEmpty(value: string[] | undefined): string[] | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Write one known field, leaving the document alone where there is nothing to
 * say.
 *
 * `undefined` deletes rather than skips. Callers build the whole
 * `DocumentFrontmatter` they want and pass it, so a field they left out is one
 * they mean to be gone -- `link_remove` clearing the last link relies on that.
 * Unknown keys are never touched, because nothing here names them.
 */
function applyField(params: {
  doc: Document.Parsed | Document;
  key: string;
  value: string | string[] | undefined;
}): void {
  const { doc, key, value } = params;

  if (value === undefined) {
    doc.delete(key);
    return;
  }

  // Unchanged means untouched. Rewriting a value that already says what it
  // should would discard the author's own quoting and any comment on the line,
  // which is the whole class of damage this module exists to stop.
  if (matchesExisting({ doc, key, value })) return;

  if (Array.isArray(value)) {
    doc.set(key, value);
    return;
  }

  doc.set(key, scalarFor(value));
}

function matchesExisting(params: {
  doc: Document.Parsed | Document;
  key: string;
  value: string | string[];
}): boolean {
  const { doc, key, value } = params;
  const node = doc.get(key);

  if (Array.isArray(value)) {
    if (!isSeq(node)) return false;
    const items: unknown = node.toJSON();
    return Array.isArray(items) && JSON.stringify(items) === JSON.stringify(value);
  }

  return node === value;
}

/**
 * Prefer plain style, which is what the hand-written serialiser produced and
 * what the documents in the wild look like -- but only where plain round-trips.
 * `description: yes` reads back as a boolean, so a value whose plain form means
 * something else has to keep its quotes.
 */
function scalarFor(value: string): Scalar {
  const scalar = new Scalar(value);
  scalar.type = Scalar.PLAIN;

  const roundTripped: unknown = parseDocument(`v: ${scalar.toString()}`).get("v");
  if (roundTripped !== value) {
    scalar.type = Scalar.QUOTE_DOUBLE;
  }
  return scalar;
}
