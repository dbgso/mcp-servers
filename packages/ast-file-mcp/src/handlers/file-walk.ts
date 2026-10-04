import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

/** Directories that never hold the documents being looked for. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/**
 * Every file under `directory` whose extension is one of `extensions`, sorted.
 * Directories that cannot be read are passed over.
 */
export async function findFilesByExtension(params: { directory: string; extensions: string[] }): Promise<string[]> {
  const { directory, extensions } = params;
  const results: string[] = [];

  const searchDir = async (dir: string): Promise<void> => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) {
            await searchDir(fullPath);
          }
        } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase().slice(1))) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors etc.
    }
  };

  await searchDir(directory);
  return results.sort();
}
