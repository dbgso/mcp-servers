/**
 * System Docs Unit Tests
 *
 * Tests for the ensureSystemDocs function.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureSystemDocs } from "../services/system-docs.js";

const tempBase = path.join(process.cwd(), "src/__tests__/temp-system-docs");

describe("ensureSystemDocs", () => {
  beforeEach(async () => {
    await fs.mkdir(tempBase, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create system docs directory and files when they don't exist", async () => {
    await ensureSystemDocs({ docsDir: tempBase });

    const systemDocsDir = path.join(tempBase, "_mcp-interactive-instruction");
    const draftApprovalPath = path.join(systemDocsDir, "draft-approval.md");

    // Verify directory was created
    const dirStat = await fs.stat(systemDocsDir);
    expect(dirStat.isDirectory()).toBe(true);

    // Verify file was created
    const fileStat = await fs.stat(draftApprovalPath);
    expect(fileStat.isFile()).toBe(true);

    // Verify content
    const content = await fs.readFile(draftApprovalPath, "utf-8");
    expect(content).toContain("# Draft Approval Workflow");
    expect(content).toContain("editing → self_review → user_reviewing → pending_approval → applied");
  });

  it("should not overwrite existing system docs", async () => {
    const systemDocsDir = path.join(tempBase, "_mcp-interactive-instruction");
    const draftApprovalPath = path.join(systemDocsDir, "draft-approval.md");

    // Create directory and file with custom content
    await fs.mkdir(systemDocsDir, { recursive: true });
    const customContent = "# Custom Content\n\nThis should not be overwritten.";
    await fs.writeFile(draftApprovalPath, customContent, "utf-8");

    // Call ensureSystemDocs
    await ensureSystemDocs({ docsDir: tempBase });

    // Verify content was not overwritten
    const content = await fs.readFile(draftApprovalPath, "utf-8");
    expect(content).toBe(customContent);
  });

  it("should create directory structure recursively", async () => {
    const nestedPath = path.join(tempBase, "nested", "deep", "docs");
    await fs.mkdir(nestedPath, { recursive: true });

    await ensureSystemDocs({ docsDir: nestedPath });

    const systemDocsDir = path.join(nestedPath, "_mcp-interactive-instruction");
    const dirStat = await fs.stat(systemDocsDir);
    expect(dirStat.isDirectory()).toBe(true);
  });
});
