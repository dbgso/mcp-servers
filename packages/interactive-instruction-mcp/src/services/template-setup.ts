import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PLAN_DIR_NAME = "_mcp-interactive-instruction/plan";
const TEMPLATE_SUBDIR = "_mcp-interactive-instruction/plan/self-review";

interface SetupResult {
  action: "created_empty" | "copied_templates" | "already_exists";
  path: string;
}

/**
 * Get the templates directory path relative to this module
 */
function getTemplatesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(path.dirname(currentFile));
  const packageDir = path.dirname(srcDir);
  return path.join(packageDir, "templates");
}

/**
 * Recursively copy a directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Check if a directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Setup self-review templates in the user's markdown directory.
 *
 * Behavior:
 * - If `_mcp-interactive-instruction/plan/` directory exists: Copy templates to `self-review/` subdirectory
 * - If directory doesn't exist: Create empty `_mcp-interactive-instruction/plan/` directory
 *   (so we don't ask again next time)
 *
 * @param markdownDir - The user's markdown documentation directory
 * @returns SetupResult indicating what action was taken
 */
export async function setupSelfReviewTemplates(
  markdownDir: string
): Promise<SetupResult> {
  const planDirPath = path.join(markdownDir, PLAN_DIR_NAME);
  const selfReviewPath = path.join(markdownDir, TEMPLATE_SUBDIR);

  // Check if self-review templates already exist
  if (await directoryExists(selfReviewPath)) {
    // Check if there are actual files in the directory
    try {
      const entries = await fs.readdir(selfReviewPath);
      if (entries.length > 0) {
        return { action: "already_exists", path: selfReviewPath };
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  // Try to copy templates
  const templatesDir = getTemplatesDir();
  const templateSrcPath = path.join(templatesDir, TEMPLATE_SUBDIR);

  // Copy templates if they exist in the package
  if (await directoryExists(templateSrcPath)) {
    await copyDirectory(templateSrcPath, selfReviewPath);
    return { action: "copied_templates", path: selfReviewPath };
  }

  // Templates not found in package - create empty directory to mark as "checked"
  await fs.mkdir(planDirPath, { recursive: true });
  return { action: "created_empty", path: planDirPath };
}

/**
 * Check if template setup is needed (plan directory doesn't exist)
 */
export async function needsTemplateSetup(markdownDir: string): Promise<boolean> {
  const planDirPath = path.join(markdownDir, PLAN_DIR_NAME);
  return !(await directoryExists(planDirPath));
}
