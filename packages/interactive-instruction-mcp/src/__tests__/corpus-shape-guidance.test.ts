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

  /**
   * The criterion for a rule has to ship with the rule.
   *
   * The hub rules are compiled into the package and run against whatever corpus
   * the server is pointed at. What a hub is was first written as a document in
   * this repository's own corpus, which is in no published artifact: `npm pack`
   * ships `dist`, `templates`, `README.md` and `LICENSE`, and nothing from
   * `docs/`. So a caller elsewhere was told to rename their `overview` with
   * nothing to read about why. These assertions are what keeps it in the one
   * place that travels with the rule.
   */
  it.each([
    { question: "when a family needs a hub", expected: "At two members" },
    { question: "where the hub lives", expected: "the document at the family's id" },
    { question: "what the wrong place looks like", expected: "coding-rules__overview" },
    { question: "how much the hub says per member", expected: "One line per member" },
    { question: "why the hub is the part that rots", expected: "never reread" },
    { question: "what moves the threshold", expected: "IIMCP_LINT_HUB_CHILDREN" },
  ])("answers $question", ({ expected }) => {
    expect(describeText).toContain(expected);
  });

  it.each(["prefer-hub-reference", "stale-hub-index", "misplaced-hub"])(
    "names %s, so a finding can be read back to its criterion",
    (rule) => {
      expect(describeText).toContain(rule);
    },
  );

  it("does not tell the caller to repeat the directory hierarchy", () => {
    // Ids already carry it and `graph` draws it as node colour, so duplicating
    // it in `relatedDocs` is work that can go stale. The guidance has to say
    // which axis is which, or the two drift -- reported as `list(id: "coding")`
    // showing four documents while `graph` scattered them across two places.
    expect(describeText).toContain("not repeated here");
  });
});
