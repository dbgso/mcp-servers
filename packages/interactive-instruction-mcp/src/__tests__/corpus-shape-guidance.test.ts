/**
 * The shape `relatedDocs` is supposed to take, written down.
 *
 * It was not, and the five questions it leaves open were answered differently on
 * each write. A 47-document migration reported the result: the lint finding says
 * only "not referenced by any other document", so edges were added in whichever
 * direction silenced it, and `testing` ended up with three of its four parents
 * among its own children. No cycle, so nothing was reported; a correct DAG that
 * cannot be read.
 *
 * The direction was never a free choice -- `orphaned-document` counts inbound
 * edges, so parent to child leaves only the entry points unreferenced while child
 * to parent leaves every leaf unreferenced. The rule's own shape had decided it.
 * Nothing said so.
 */

import { describe, it, expect } from "vitest";
import { buildDescribeText } from "../tools/instruction/index.js";
import type { ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const describeText = buildDescribeText(config);

describe("describe answers what shape the corpus should take", () => {
  it.each([
    { question: "which direction an edge runs", expected: "Edges run parent to child" },
    { question: "why that direction", expected: "orphaned-document" },
    { question: "whether two parents are allowed", expected: "Two parents are allowed" },
    { question: "when a category needs an index", expected: "wants an index" },
    { question: "how directories relate to it", expected: "the other axis" },
  ])("answers $question", ({ expected }) => {
    expect(describeText).toContain(expected);
  });

  it("names the call that adds an edge in that direction", () => {
    // The parent is the `id`, the child is in `relatedDocs`. An example with
    // them the other way round would undo the paragraph above it.
    expect(describeText).toContain(
      'instruction(action: "link_add", id: "<parent>", relatedDocs: ["<child>"]'
    );
  });

  it("does not tell the caller to repeat the directory hierarchy", () => {
    // Ids already carry it and `graph` draws it as node colour, so duplicating
    // it in `relatedDocs` is work that can go stale. The guidance has to say
    // which axis is which, or the two drift -- reported as `list(id: "coding")`
    // showing four documents while `graph` scattered them across two places.
    expect(describeText).toContain("not repeated here");
  });
});
