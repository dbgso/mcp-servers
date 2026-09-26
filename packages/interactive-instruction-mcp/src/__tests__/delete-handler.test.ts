/**
 * `delete`, and what carries its risk.
 *
 * The gate in front of it is deliberation, which proves disclosure and not
 * consent: nothing verifies a human agreed. So the file has to survive. These
 * tests are as much about the trash directory as about the gate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { DeleteHandler } from "../tools/instruction/handlers/delete.js";
import { ListHandler } from "../tools/instruction/handlers/list.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, TRASH_DIR } from "../constants.js";
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

    it("moves the file to the trash rather than erasing it", async () => {
      await write("policy");

      const { response } = await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));

      expect(response.isError).toBeFalsy();
      expect(await reader.getDocumentContent("policy")).toBeNull();

      const trashed = await fs.readdir(path.join(docsDir, TRASH_DIR));
      expect(trashed).toHaveLength(1);
      expect(trashed[0]).toMatch(/^policy--/);
      expect(await fs.readFile(path.join(docsDir, TRASH_DIR, trashed[0]), "utf-8")).toContain(
        "Body of policy"
      );
    });

    it("keeps both copies when the same id is deleted twice", async () => {
      await write("policy");
      await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));

      await write("policy");
      resetMutationGatesForTesting();
      await throughGate(() => del({ id: "policy", explanation: "And again, for the same reason." }));

      // Without the timestamp the second delete would overwrite the first, and
      // the recovery this whole directory exists for would be gone.
      expect(await fs.readdir(path.join(docsDir, TRASH_DIR))).toHaveLength(2);
    });

    it("says where the file went", async () => {
      await write("policy");

      const { response } = await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));

      // A caller that cannot tell the user where the document went cannot help
      // them get it back.
      expect(response.content[0].text).toContain(TRASH_DIR);
    });
  });

  describe("the trash directory is not part of the corpus", () => {
    beforeEach(async () => {
      await write("policy");
      await throughGate(() => del({ id: "policy", explanation: EXPLANATION }));
    });

    it("is left out of list", async () => {
      const result = await new ListHandler().execute({
        rawParams: { action: "list", recursive: true },
        context,
      });

      expect(result.content[0].text).not.toContain(TRASH_DIR);
      expect(result.content[0].text).not.toContain("policy--");
    });

    it("is left out of lint", async () => {
      // Otherwise every deleted document comes back as a complaint about its
      // metadata.
      const result = await new LintHandler().execute({ rawParams: { action: "lint" }, context });

      expect(result.content[0].text).not.toContain(TRASH_DIR);
      expect(result.content[0].text).not.toContain("policy--");
    });
  });
});
