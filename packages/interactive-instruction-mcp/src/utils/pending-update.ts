import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const PENDING_DIR = path.join(os.tmpdir(), "mcp-instruction-pending");

export interface PendingUpdate {
  id: string;
  content: string;
  originalPath: string;
  diffPath: string;
  timestamp: number;
}

/**
 * Save a pending update for later application.
 */
export async function savePendingUpdate(params: {
  id: string;
  content: string;
  originalPath: string;
  diffPath: string;
}): Promise<string> {
  const { id, content, originalPath, diffPath } = params;

  await fs.mkdir(PENDING_DIR, { recursive: true });

  const pendingData: PendingUpdate = {
    id,
    content,
    originalPath,
    diffPath,
    timestamp: Date.now(),
  };

  // Sanitize id for filename
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(PENDING_DIR, `${safeId}.json`);

  await fs.writeFile(filePath, JSON.stringify(pendingData, null, 2), "utf-8");

  return filePath;
}

/**
 * Get a pending update by id.
 */
export async function getPendingUpdate(id: string): Promise<PendingUpdate | null> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(PENDING_DIR, `${safeId}.json`);

  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as PendingUpdate;
  } catch {
    return null;
  }
}

/**
 * Delete a pending update by id.
 */
export async function deletePendingUpdate(id: string): Promise<boolean> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(PENDING_DIR, `${safeId}.json`);

  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all pending updates.
 */
export async function listPendingUpdates(): Promise<PendingUpdate[]> {
  try {
    const files = await fs.readdir(PENDING_DIR);
    const updates: PendingUpdate[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(PENDING_DIR, file);
        const data = await fs.readFile(filePath, "utf-8");
        updates.push(JSON.parse(data) as PendingUpdate);
      }
    }

    return updates.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}
