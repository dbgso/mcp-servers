/**
 * Claims on disk: one claim per file, at `<root>/<kind>/<id>.yaml`.
 *
 * One file per claim so that two people adding claims do not conflict, and so
 * that the id is the file name and cannot disagree with it. The whole root is
 * read on every call: it is a few hundred small files, and a cache would be one
 * more thing that could be out of date with what is on disk.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ClaimSchema, GapSchema, type Claim, type Gap } from "./claim.js";
import { GAP_KIND } from "./kinds.js";

const EXTENSION = ".yaml";
const ID_DIGITS = 4;

/** Everything under a root, read at one moment. */
export interface Snapshot {
  claims: Map<string, Claim>;
  gaps: Map<string, Gap>;
}

export class ClaimStore {
  constructor(readonly root: string) {}

  async snapshot(): Promise<Snapshot> {
    const claims = new Map<string, Claim>();
    const gaps = new Map<string, Gap>();

    for (const kind of await this.kindDirectories()) {
      for (const file of await this.filesOf(kind)) {
        const parsed: unknown = parseYaml(await readFile(file, "utf8"));
        this.place({ parsed, file, claims, gaps });
      }
    }

    return { claims, gaps };
  }

  /** Overwrite a claim that already has an id. */
  async writeClaim(claim: Claim): Promise<void> {
    await this.write({ kind: claim.kind, id: claim.id, data: claim });
  }

  /** Overwrite a gap that already has an id. */
  async writeGap(gap: Gap): Promise<void> {
    await this.write({ kind: GAP_KIND, id: gap.id, data: gap });
  }

  /**
   * Write something new under the next free id of its kind.
   *
   * Two callers adding at once both read the same highest id, so the file is
   * created exclusively and the loser takes the next id rather than replacing
   * the winner's claim (S-0006 in docs/claims).
   */
  async create<T extends Claim | Gap>(params: { kind: string; build: (id: string) => T }): Promise<T> {
    // Outside the retry: `mkdir` also fails with EEXIST, when a file sits where
    // the directory should be, and that is not an id someone else took.
    const directory = await this.directoryOf(params.kind);
    for (;;) {
      const data = params.build(await this.nextId(params.kind));
      const written = await writeFile(path.join(directory, `${data.id}${EXTENSION}`), stringifyYaml(data), {
        flag: "wx",
      }).then(
        () => true,
        (error: NodeJS.ErrnoException) => taken(error)
      );
      if (written) return data;
    }
  }

  /**
   * The next id for a kind: one past the highest issued.
   *
   * The highest rather than the count, so an id freed by deleting a file is
   * never issued again for a different claim.
   */
  async nextId(kind: string): Promise<string> {
    const files = await this.filesOf(kind);
    const numbers = files.map((file) => Number(path.basename(file, EXTENSION).slice(kind.length + 1)));
    const highest = Math.max(0, ...numbers.filter(Number.isInteger));
    return `${kind}-${String(highest + 1).padStart(ID_DIGITS, "0")}`;
  }

  private async write(params: { kind: string; id: string; data: Claim | Gap }): Promise<void> {
    const directory = await this.directoryOf(params.kind);
    await writeFile(path.join(directory, `${params.id}${EXTENSION}`), stringifyYaml(params.data));
  }

  private async directoryOf(kind: string): Promise<string> {
    const directory = path.join(this.root, kind);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private async kindDirectories(): Promise<string[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  private async filesOf(kind: string): Promise<string[]> {
    const directory = path.join(this.root, kind);
    const names = await readdir(directory).catch(() => []);
    return names.filter((name) => name.endsWith(EXTENSION)).map((name) => path.join(directory, name));
  }

  /** File a parsed document as a gap or a claim, refusing one that is neither. */
  private place(params: {
    parsed: unknown;
    file: string;
    claims: Map<string, Claim>;
    gaps: Map<string, Gap>;
  }): void {
    const { parsed, file, claims, gaps } = params;
    const gap = GapSchema.safeParse(parsed);
    if (gap.success) {
      gaps.set(gap.data.id, gap.data);
      return;
    }

    const claim = ClaimSchema.safeParse(parsed);
    if (!claim.success) {
      throw new Error(`${file} is not a claim: ${claim.error.message}`);
    }
    claims.set(claim.data.id, claim.data);
  }
}

/** `false` when the id was taken by someone else first; any other failure is thrown. */
function taken(error: NodeJS.ErrnoException): false {
  if (error.code !== "EEXIST") throw error;
  return false;
}
