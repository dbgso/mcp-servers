/**
 * Updates to promoted documents are staged here rather than written straight
 * out: `update` computes the diff, the human reads it, `apply` writes it.
 *
 * The store is keyed by document id and scoped to the documents directory the
 * server was started with. Both matter. It used to be one shared
 * `$TMPDIR/mcp-instruction-pending` for every server on the machine, keyed by
 * `id.replace(/[^a-zA-Z0-9_-]/g, "_")` -- so `設計` and `方針` were the same
 * entry, and so were `overview` in two different projects. `apply` then trusted
 * the `originalPath` it read back, which is how one server's apply could write
 * another server's file and report success under the wrong id.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { contentHash } from "mcp-shared/approval";
import { scopedStateDir } from "../services/instance-scope.js";

const PENDING_BASE = "mcp-instruction-pending";

/**
 * A staged update is a human-review artifact, not a durable record. A day is
 * long enough to come back to one after a break, and short enough that a
 * forgotten `update` does not sit in tmp indefinitely waiting to overwrite a
 * document the world has moved past.
 */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingUpdate {
  id: string;
  content: string;
  originalPath: string;
  diffPath: string;
  timestamp: number;
  /**
   * Hash of the document as it stood when the diff was computed. `apply`
   * refuses if it no longer matches: the diff the human read was against that
   * version, and writing anyway silently discarded whatever changed in between.
   */
  originalHash: string;
}

function storeDir(docsDir: string): string {
  return scopedStateDir({
    base: PENDING_BASE,
    docsDir,
    override: process.env.MCP_INSTRUCTION_PENDING_DIR,
  });
}

/**
 * Percent-encoded so that two ids never share a file. The previous scheme
 * replaced every character outside `[a-zA-Z0-9_-]`, which collapsed every
 * non-ASCII id onto one key.
 */
function pendingFilePath(params: { docsDir: string; id: string }): string {
  return path.join(storeDir(params.docsDir), `${encodeURIComponent(params.id)}.json`);
}

export async function savePendingUpdate(params: {
  docsDir: string;
  id: string;
  content: string;
  originalContent: string;
  originalPath: string;
  diffPath: string;
}): Promise<string> {
  const { docsDir, id, content, originalContent, originalPath, diffPath } = params;

  await fs.mkdir(storeDir(docsDir), { recursive: true });

  const pendingData: PendingUpdate = {
    id,
    content,
    originalPath,
    diffPath,
    timestamp: Date.now(),
    originalHash: contentHash(originalContent),
  };

  const filePath = pendingFilePath({ docsDir, id });
  await fs.writeFile(filePath, JSON.stringify(pendingData, null, 2), "utf-8");

  return filePath;
}

export async function getPendingUpdate(params: {
  docsDir: string;
  id: string;
}): Promise<PendingUpdate | null> {
  try {
    const data = await fs.readFile(pendingFilePath(params), "utf-8");
    const parsed = JSON.parse(data) as PendingUpdate;
    if (Date.now() - parsed.timestamp > PENDING_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deletePendingUpdate(params: {
  docsDir: string;
  id: string;
}): Promise<boolean> {
  try {
    await fs.unlink(pendingFilePath(params));
    return true;
  } catch {
    return false;
  }
}

export async function listPendingUpdates(params: { docsDir: string }): Promise<PendingUpdate[]> {
  const dir = storeDir(params.docsDir);
  try {
    const files = await fs.readdir(dir);
    const updates: PendingUpdate[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(dir, file), "utf-8");
        const parsed = JSON.parse(data) as PendingUpdate;
        if (Date.now() - parsed.timestamp > PENDING_TTL_MS) continue;
        updates.push(parsed);
      } catch {
        // A file this module did not write, or one caught half-written. Skip it
        // rather than failing the whole listing.
      }
    }

    return updates.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}
