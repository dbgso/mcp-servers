import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const HASH_LENGTH = 16;
const GLOB_CHARS = /[*?[\]{}]/;

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Hash of what a document says: its title and body.
 *
 * Frontmatter is left out on purpose. Confirming a link rewrites the
 * baseline in the frontmatter, and that must not count as the document
 * changing, or every confirmation would make the children suspect.
 */
export function hashDocument(doc: { title: string; content: string }): string {
  return sha256(`${doc.title}\n${doc.content.trim()}`);
}

/**
 * Expand a code reference into the files it covers, relative to the root
 * and sorted. A file is itself, a directory is every file under it, and a
 * pattern with glob characters is expanded as a glob.
 */
export function expandCodePath(params: { root: string; pattern: string }): string[] {
  const { root, pattern } = params;
  // A glob is expanded by the filesystem, a plain path is looked at directly
  if (GLOB_CHARS.test(pattern)) {
    return listFiles({ root, pattern });
  }
  const absolute = path.resolve(root, pattern);
  if (!existsSync(absolute)) return [];
  // A directory stands for every file under it
  if (statSync(absolute).isDirectory()) {
    return listFiles({ root, pattern: `${pattern.replace(/\/+$/, "")}/**/*` });
  }
  return [path.relative(root, absolute)];
}

function listFiles(params: { root: string; pattern: string }): string[] {
  const { root, pattern } = params;
  return globSync(pattern, { cwd: root })
    .filter(file => statSync(path.resolve(root, file)).isFile())
    .map(file => file.split(path.sep).join("/"))
    .sort();
}

/**
 * Hash of the code a reference covers, or null when it covers nothing.
 * The file names are part of the hash, so a rename is a change.
 */
export function hashCode(params: { root: string; pattern: string }): string | null {
  const { root } = params;
  const files = expandCodePath(params);
  if (files.length === 0) return null;
  const lines = files.map(file => `${file}\0${sha256(readFileSync(path.resolve(root, file)))}`);
  return sha256(lines.join("\n"));
}
