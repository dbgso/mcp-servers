import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * A file name a person can recognise in a directory listing: when, then what.
 *
 * Only ASCII letters and digits survive into the slug, so a title in Japanese
 * falls back to `report` rather than producing a name some tool will mangle.
 */
export function reportFileName(params: { title: string; now: Date }): string {
  const { title, now } = params;
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${stamp}-${slug === "" ? "report" : slug}`;
}

/** Whether a write failed only because the name was taken. */
function isTaken(params: { error: unknown }): boolean {
  const { error } = params;
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

/** The path of the `attempt`-th candidate: `r.html`, then `r-2.html`, `r-3.html`, ... */
function candidatePath(params: { dir: string; baseName: string; extension: string; attempt: number }): string {
  const { dir, baseName, extension, attempt } = params;
  const suffix = attempt === 1 ? "" : `-${attempt}`;
  return path.join(dir, `${baseName}${suffix}.${extension}`);
}

/** Write only if the file does not exist yet. False when the name was taken. */
async function writeIfAbsent(params: { filePath: string; content: string }): Promise<boolean> {
  const { filePath, content } = params;
  try {
    await writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (error) {
    if (isTaken({ error })) return false;
    throw error;
  }
}

/**
 * Write `content` to a file in `dir` that did not exist before, and return its
 * path.
 *
 * Never overwrites. A name already taken gets `-2`, `-3`, ... appended; the
 * exclusive flag makes the check and the write one step, so two reports in the
 * same second cannot both claim the same name.
 */
export async function writeNewFile(params: {
  dir: string;
  baseName: string;
  extension: string;
  content: string;
}): Promise<string> {
  const { dir, baseName, extension, content } = params;
  await mkdir(dir, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const filePath = candidatePath({ dir, baseName, extension, attempt });
    if (await writeIfAbsent({ filePath, content })) return filePath;
  }
}
