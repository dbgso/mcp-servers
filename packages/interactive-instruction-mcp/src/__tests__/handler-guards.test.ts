/**
 * The guards and the empty cases across the handlers.
 *
 * Small branches, one per thing that can be absent: a document with no
 * relations, a link list that empties out, a destination already taken, a
 * rename that fails, a graph with nothing to draw, a fence opened with tildes.
 * None of them are the interesting path, which is why none of them were
 * covered -- and each is a message a caller reads instead of a result.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX, TRASH_DIR } from "../constants.js";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
import { LinkRemoveHandler } from "../tools/instruction/handlers/link-remove.js";
import { DeleteHandler } from "../tools/instruction/handlers/delete.js";
import { RenameHandler } from "../tools/instruction/handlers/rename.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { GraphHandler } from "../tools/instruction/handlers/graph.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { ReadHandler } from "../tools/instruction/handlers/read.js";
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const WHY = "Because the corpus needs it.";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

async function write(params: {
  id: string;
  frontmatter?: string;
  body?: string;
  draft?: boolean;
}): Promise<void> {
  const { id, frontmatter = "description: a doc\nwhenToUse:\n  - testing", body, draft } = params;
  const base = draft === true ? path.join(docsDir, DRAFT_DIR) : docsDir;
  const file = path.join(base, `${id.split("__").join(path.sep)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `---\n${frontmatter}\n---\n\n${body ?? `# ${id}\n`}`, "utf-8");
  reader.invalidateCache();
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "handler-guards-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("link_add on a document with no relations yet", () => {
  it("says the list was empty before, and what it is now", async () => {
    await write({ id: "host" });
    await write({ id: "target" });

    const first = await new LinkAddHandler().execute({
      rawParams: { action: "link_add", id: "host", relatedDocs: ["target"], explanation: WHY },
      context,
    });

    expect(isRefusal(first)).toBe(true);
    expect(text(first)).toContain("(none)");
    expect(text(first)).toContain("target");
  });
});

describe("link_remove", () => {
  it("shows (none) once the last link goes", async () => {
    // The frontmatter key is dropped rather than left empty, so the preview is
    // the only place that says what the document ends up with.
    await write({ id: "host", frontmatter: "description: a doc\nrelatedDocs:\n  - target" });
    await write({ id: "target" });

    const { response } = await throughGate(() =>
      new LinkRemoveHandler().execute({
        rawParams: {
          action: "link_remove",
          id: "host",
          relatedDocs: ["target"],
          explanation: WHY,
        },
        context,
      })
    );

    expect(response.isError).toBeFalsy();
    expect(text(response)).toContain("(none)");
    expect(await reader.getDocumentContent("host")).not.toContain("relatedDocs");
  });

  it("says the link was not there rather than removing nothing quietly", async () => {
    await write({ id: "host" });

    const result = await new LinkRemoveHandler().execute({
      rawParams: { action: "link_remove", id: "host", relatedDocs: ["absent"], explanation: WHY },
      context,
    });

    expect(text(result)).toContain("None of the specified documents are in relatedDocs");
  });

  it("reports a write that failed", async () => {
    await write({ id: "host", frontmatter: "description: a doc\nrelatedDocs:\n  - target" });
    await write({ id: "target" });
    const call = () =>
      new LinkRemoveHandler().execute({
        rawParams: {
          action: "link_remove",
          id: "host",
          relatedDocs: ["target"],
          explanation: WHY,
        },
        context,
      });

    let result;
    do {
      const spy = vi
        .spyOn(reader, "updateDocument")
        .mockResolvedValue({ success: false, error: "simulated write failure" });
      result = await call();
      spy.mockRestore();
    } while (isRefusal(result));

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated write failure");
  });
});

describe("delete", () => {
  it("says nothing links to a document when nothing does", async () => {
    await write({ id: "lonely" });

    const refused = await new DeleteHandler().execute({
      rawParams: { action: "delete", id: "lonely", explanation: WHY },
      context,
    });

    expect(text(refused)).toContain("Nothing links to it");
  });

  it("names the trash path it moved the file to", async () => {
    await write({ id: "doomed" });

    const { response } = await throughGate(() =>
      new DeleteHandler().execute({
        rawParams: { action: "delete", id: "doomed", explanation: WHY },
        context,
      })
    );

    expect(text(response)).toContain(TRASH_DIR);
    expect(text(response)).toContain("doomed--");
  });

  it("gates on the content it can read, and still refuses when it cannot", async () => {
    // `what` includes the document's content. A read that comes back empty
    // must not make two different documents hash the same.
    await write({ id: "unreadable" });
    vi.spyOn(reader, "getDocumentContent").mockResolvedValue(null);

    const result = await new DeleteHandler().execute({
      rawParams: { action: "delete", id: "unreadable", explanation: WHY },
      context,
    });

    expect(isRefusal(result) || result.isError === true).toBe(true);
  });
});

describe("rename", () => {
  it("refuses when a draft and a promoted document share the id", async () => {
    await write({ id: "both" });
    await write({ id: "both", draft: true });

    const result = await new RenameHandler().execute({
      rawParams: { action: "rename", id: "both", newId: "other", explanation: WHY },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Both draft and promoted");
  });

  it("reports a draft rename that failed", async () => {
    await write({ id: "drafted", draft: true });
    vi.spyOn(reader, "renameDocument").mockResolvedValue({
      success: false,
      error: "simulated rename failure",
    });

    const result = await new RenameHandler().execute({
      rawParams: { action: "rename", id: "drafted", newId: "renamed" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated rename failure");
  });

  it("refuses a destination that a draft already holds", async () => {
    await write({ id: "source", draft: true });
    await write({ id: "taken", draft: true });

    const result = await new RenameHandler().execute({
      rawParams: { action: "rename", id: "source", newId: "taken" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("already exists");
  });
});

describe("update on a draft with no frontmatter at all", () => {
  it("keeps the body and adds the metadata it was given", async () => {
    await fs.writeFile(
      path.join(docsDir, DRAFT_DIR, "bare.md"),
      "# Bare\n\nA body with no frontmatter.\n",
      "utf-8"
    );
    reader.invalidateCache();

    const result = await new UpdateHandler().execute({
      rawParams: { action: "update", id: "bare", description: "now described" },
      context,
    });

    expect(result.isError).toBeFalsy();
    const written = await reader.getDocumentContent(DRAFT_PREFIX + "bare");
    expect(written).toContain("description: now described");
    expect(written).toContain("A body with no frontmatter.");
  });

  it("infers a description from the first paragraph when none is given", async () => {
    await fs.writeFile(
      path.join(docsDir, DRAFT_DIR, "inferred.md"),
      "# Title\n\nThe first paragraph.\n",
      "utf-8"
    );
    reader.invalidateCache();

    await new UpdateHandler().execute({
      rawParams: { action: "update", id: "inferred", content: "# Title\n\nThe first paragraph.\n" },
      context,
    });

    expect(await reader.getDocumentContent(DRAFT_PREFIX + "inferred")).toContain(
      "The first paragraph."
    );
  });

  it("stops inferring at a code fence", async () => {
    await fs.writeFile(path.join(docsDir, DRAFT_DIR, "fenced.md"), "# T\n", "utf-8");
    reader.invalidateCache();

    await new UpdateHandler().execute({
      rawParams: { action: "update", id: "fenced", content: "# T\n\n```sh\nnot a description\n```\n" },
      context,
    });

    const written = await reader.getDocumentContent(DRAFT_PREFIX + "fenced");
    expect(written).not.toContain("description: not a description");
  });
});

describe("graph", () => {
  it("says there is nothing to draw for a corpus with no relations", async () => {
    await write({ id: "alone" });

    const result = await new GraphHandler().execute({
      rawParams: { action: "graph", format: "text" },
      context,
    });

    expect(text(result)).toContain("No relations to draw");
  });

  it("names the document and its depth for an empty neighbourhood", async () => {
    await write({ id: "alone" });

    const result = await new GraphHandler().execute({
      rawParams: { action: "graph", id: "alone", format: "text" },
      context,
    });

    expect(text(result)).toContain("alone, depth 1");
    expect(text(result)).toContain("referenced by: (not");
  });

  it("writes a page for one document's neighbourhood even when it is empty", async () => {
    // `includeUnlinked` is off by default, so the corpus has no nodes -- and
    // the html path still answers with a page rather than an error.
    await write({ id: "alone" });

    const result = await new GraphHandler().execute({
      rawParams: { action: "graph", id: "alone" },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Wrote the relation graph to");
  });

  it("counts one dangling link in the singular", async () => {
    // The html path is where the warning lives; `format: "text"` returns the
    // adjacency list and leaves the reading to the caller.
    await write({ id: "host", frontmatter: "description: a doc\nrelatedDocs:\n  - nowhere" });

    const result = await new GraphHandler().execute({
      rawParams: { action: "graph" },
      context,
    });

    expect(text(result)).toContain("1 link point");
    expect(text(result)).not.toContain("1 links point");
  });

  it("counts several in the plural", async () => {
    await write({
      id: "host",
      frontmatter: "description: a doc\nrelatedDocs:\n  - nowhere\n  - elsewhere",
    });

    expect(text(await new GraphHandler().execute({ rawParams: { action: "graph" }, context }))).toContain(
      "2 links point"
    );
  });

  it("writes to the path it is given", async () => {
    await write({ id: "host", frontmatter: "description: a doc\nrelatedDocs:\n  - target" });
    await write({ id: "target" });
    const outputPath = path.join(tempDir, "graph.html");

    const result = await new GraphHandler().execute({
      rawParams: { action: "graph", outputPath },
      context,
    });

    expect(text(result)).toContain(outputPath);
    expect(await fs.readFile(outputPath, "utf-8")).toContain("cytoscape");
  });
});

describe("lint", () => {
  it("does not call a `_`-prefixed document an orphan, but does check its metadata", async () => {
    // The orphan rule skips `_` because a document under one was the server's
    // own and deliberately unlinked. The metadata rules do not skip it. With
    // the seeded document gone, a `_` directory is the user's own, so the
    // asymmetry now reads oddly -- recorded rather than changed, because
    // which way it should go is the user's call.
    await write({ id: "_internal__notes", frontmatter: "description: ''" });
    await write({ id: "real", frontmatter: "description: a real doc\nwhenToUse:\n  - testing" });

    const result = await new LintHandler().execute({ rawParams: { action: "lint" }, context });
    const output = text(result);

    const orphanLines = output
      .split("\n")
      .filter((line) => line.includes("orphaned-document") || line.includes("_internal__notes"));
    expect(output).toContain("missing-description");
    expect(orphanLines.join("\n")).not.toContain("orphaned-document: _internal__notes");
  });

  it("reads a fence opened with tildes", async () => {
    await write({
      id: "tilde",
      body: "# T\n\n## Ex\n\n~~~sh\n# Ex\n~~~\n\n~~~sh\n# Ex\n~~~\n",
    });

    const result = await new LintHandler().execute({ rawParams: { action: "lint" }, context });

    expect(text(result)).not.toContain("duplicate-heading");
  });

  it("reports a cycle once, however many ways round it there are", async () => {
    await write({ id: "a", frontmatter: "description: a\nrelatedDocs:\n  - b" });
    await write({ id: "b", frontmatter: "description: b\nrelatedDocs:\n  - a" });

    const result = await new LintHandler().execute({ rawParams: { action: "lint" }, context });

    const occurrences = text(result).split("circular-reference").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("read", () => {
  it("says a document is not there rather than returning nothing", async () => {
    const result = await new ReadHandler().execute({
      rawParams: { action: "read", id: "absent" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });
});
