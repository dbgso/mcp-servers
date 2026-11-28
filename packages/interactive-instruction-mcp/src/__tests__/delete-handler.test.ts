/**
 * `delete`, and what carries its risk.
 *
 * The gate in front of it is deliberation, which proves disclosure and not
 * consent: nothing verifies a human agreed. So the file has to survive. These
 * tests are as much about what the deletion leaves behind as about the gate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { DeleteHandler } from "../tools/instruction/handlers/delete.js";
import { ListHandler } from "../tools/instruction/handlers/list.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const EXPLANATION = "This document is superseded by the new guide.";

describe("DeleteHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: DeleteHandler;
  let context: InstructionContext;

  const doc = (id: string) => `---\ndescription: ${id}\n---\n\n# ${id}\n\nBody of ${id}.`;

  const write = async (id: string) => {
    await fs.writeFile(path.join(docsDir, `${id}.md`), doc(id), "utf-8");
    reader.invalidateCache();
  };

  const del = (params: { id: string; explanation?: string }) =>
    handler.execute({
      rawParams: {
        action: "delete",
        id: params.id,
        ...(params.explanation === undefined ? {} : { explanation: params.explanation }),
      },
      context,
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "delete-handler-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
    reader = new MarkdownReader(docsDir);
    handler = new DeleteHandler();
    context = { reader, config };
    resetMutationGatesForTesting();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("drafts", () => {
    it("deletes immediately, with nothing to explain", async () => {
      await fs.writeFile(path.join(docsDir, DRAFT_DIR, "scratch.md"), doc("scratch"), "utf-8");
      reader.invalidateCache();

      const result = await del({ id: "scratch" });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("deleted");
    });
  });

  describe("promoted documents", () => {
    it("asks for an explanation first", async () => {
      await write("policy");

      const result = await del({ id: "policy" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("explanation");
      expect(await reader.getDocumentContent("policy")).toContain("Body of policy");
    });

    it("shows the links it would break, in the refusal", async () => {
      await write("policy");
      await fs.writeFile(
        path.join(docsDir, "guide.md"),
        `---\ndescription: guide\nrelatedDocs:\n  - policy\n---\n\n# guide`,
        "utf-8"
      );
      reader.invalidateCache();

      const result = await del({ id: "policy", explanation: EXPLANATION });

      expect(isRefusal(result)).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain("guide");
      expect(text).toContain("dangle");
    });

    it("removes the file", async () => {
      // 2.0.0 moved it to a `_mcp_trash/` directory instead, so that a delete
      // could be undone. Nothing ever read that directory and no action
      // restored from it, and the corpora this runs against keep their history
      // in version control -- so it was a worse copy of `git checkout` that
      // grew without bound. The gate is what makes a delete deliberate; the
      // corpus's own history is what makes it recoverable.
      await write("policy");

      await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));

      expect(await fs.access(path.join(docsDir, "policy.md")).then(() => true, () => false)).toBe(false);
      expect(await fs.readdir(docsDir)).not.toContain("_mcp_trash");
    });

    it("says where the document can be recovered from", async () => {
      await write("policy");

      const { response } = await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));

      expect(response.content[0].text).toContain("version control");
    });

    it("leaves nothing behind for the listings to show", async () => {
      // The deleted document used to survive as `policy--<timestamp>.md` in a
      // directory every listing then had to be taught to ignore.
      await write("policy");
      await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));

      const listed = await new ListHandler().execute({
        rawParams: { action: "list", recursive: true },
        context,
      });
      const linted = await new LintHandler().execute({ rawParams: { action: "lint" }, context });

      expect(listed.content[0].text).not.toContain("policy");
      expect(linted.content[0].text).not.toContain("policy");
    });
  });
});
