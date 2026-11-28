/**
 * The policy module: which gate this server installs, and how much friction
 * each operation gets.
 *
 * The point of the module is that the answer lives in one place. These tests
 * are about that one place -- the per-operation counts, the environment
 * override, and the run bookkeeping every handler inherits by going through it.
 * How each handler uses it is tested with the handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ToolResponse } from "mcp-shared";
import { gateMutation, resetMutationGatesForTesting, type GatedOperation } from "../services/mutation-gate.js";
import { errorResponse, textResponse } from "../tools/instruction/types.js";
import { isRefusal } from "./helpers/gate.js";

const EXPLANATION = "Because the document says the wrong thing.";

/** A gated call that records whether the work actually ran. */
function gatedCall(params: {
  operation: GatedOperation;
  subject?: string;
  what?: string;
  explanation?: string;
  preview?: string;
  result?: ToolResponse;
}): { call: () => Promise<ToolResponse>; ran: () => number } {
  let runs = 0;
  const call = () =>
    gateMutation({
      operation: params.operation,
      subject: params.subject ?? `instruction::${params.operation}::doc`,
      what: params.what ?? "the document, as it stands",
      explanation: params.explanation ?? EXPLANATION,
      ...(params.preview === undefined ? {} : { preview: params.preview }),
      work: async () => {
        runs++;
        return params.result ?? textResponse("done");
      },
    });
  return { call, ran: () => runs };
}

/** Attempts until the work runs. */
async function attemptsToPass(operation: GatedOperation): Promise<number> {
  const { call, ran } = gatedCall({ operation });
  for (let attempt = 1; attempt <= 10; attempt++) {
    await call();
    if (ran() > 0) return attempt;
  }
  throw new Error(`${operation} never passed`);
}

describe("mutation gate policy", () => {
  beforeEach(() => {
    resetMutationGatesForTesting();
  });

  describe("attempts per operation", () => {
    it.each([
      ["apply", 2],
      ["link", 2],
      ["approve", 2],
      ["rename", 3],
      ["delete", 3],
    ] as [GatedOperation, number][])("%s takes %i attempts", async (operation, expected) => {
      expect(await attemptsToPass(operation)).toBe(expected);
    });

    it("gives the irreversible operations more friction than the reversible ones", async () => {
      // The relationship is the policy; the numbers above are the current
      // setting of it. A delete cannot be undone by asking for the opposite,
      // an `apply` or a link change can.
      const reversible = await attemptsToPass("apply");
      resetMutationGatesForTesting();
      const not = await attemptsToPass("delete");

      expect(not).toBeGreaterThan(reversible);
    });
  });

  describe("the environment override", () => {
    const original = process.env.IIMCP_DELIBERATION_ATTEMPTS_APPLY;

    afterEach(() => {
      if (original === undefined) delete process.env.IIMCP_DELIBERATION_ATTEMPTS_APPLY;
      else process.env.IIMCP_DELIBERATION_ATTEMPTS_APPLY = original;
      resetMutationGatesForTesting();
    });

    it("raises the count for one operation", async () => {
      process.env.IIMCP_DELIBERATION_ATTEMPTS_APPLY = "4";
      resetMutationGatesForTesting();

      expect(await attemptsToPass("apply")).toBe(4);
    });

    it("can drop the friction entirely", async () => {
      // Someone running this against a corpus they do not mind losing should be
      // able to say so, rather than being made to route around the gate.
      process.env.IIMCP_DELIBERATION_ATTEMPTS_APPLY = "1";
      resetMutationGatesForTesting();

      expect(await attemptsToPass("apply")).toBe(1);
    });

    it.each(["0", "-2", "two", "", "1.5"])("ignores %o and keeps the default", async (value) => {
      // A typo in an environment variable should not stop the server, and the
      // value it falls back to is the safe direction.
      process.env.IIMCP_DELIBERATION_ATTEMPTS_APPLY = value;
      resetMutationGatesForTesting();

      expect(await attemptsToPass("apply")).toBe(2);
    });
  });

  describe("what every handler inherits", () => {
    it("shows the preview above the refusal", async () => {
      const { call } = gatedCall({ operation: "apply", preview: "## 3 links will dangle" });

      const refused = await call();

      expect(isRefusal(refused)).toBe(true);
      const text = refused.content[0].text as string;
      expect(text).toContain("3 links will dangle");
      expect(text.indexOf("3 links will dangle")).toBeLessThan(text.indexOf("Not Yet"));
    });

    it("refuses as an ordinary response, not an error", async () => {
      const { call } = gatedCall({ operation: "apply" });

      // An error invites the caller to decide the tool is broken and look for
      // another way in.
      expect((await call()).isError).toBeFalsy();
    });

    it("does not carry a run across a different change", async () => {
      const { call: first } = gatedCall({ operation: "apply", what: "version one" });
      const { call: second, ran } = gatedCall({ operation: "apply", what: "version two" });

      await first();
      await second();

      expect(ran()).toBe(0);
    });

    it("does not carry a run across a reworded explanation", async () => {
      const { call: first } = gatedCall({ operation: "apply", explanation: "one reason" });
      const { call: second, ran } = gatedCall({ operation: "apply", explanation: "another reason" });

      await first();
      await second();

      expect(ran()).toBe(0);
    });

    it("keeps two documents' runs apart", async () => {
      // An agent working through several documents interleaves them, and a gate
      // that kept only the newest run would refuse the first one forever.
      const a = gatedCall({ operation: "link", subject: "instruction::link_add::a", what: "a" });
      const b = gatedCall({ operation: "link", subject: "instruction::link_add::b", what: "b" });

      await a.call();
      await b.call();
      await a.call();

      expect(a.ran()).toBe(1);
      expect(b.ran()).toBe(0);
    });

    it("leaves the run standing when the work reports failure", async () => {
      const failing = gatedCall({
        operation: "apply",
        result: errorResponse("Error: disk full"),
      });

      await failing.call();
      const failed = await failing.call();
      expect(failed.isError).toBe(true);
      expect(failing.ran()).toBe(1);

      // The user has heard the explanation once. The next identical call must
      // not put them through it again.
      const { call, ran } = gatedCall({ operation: "apply" });
      await call();
      expect(ran()).toBe(1);
    });

    it("ends the run once the work succeeds", async () => {
      const { call, ran } = gatedCall({ operation: "apply" });

      await call();
      await call();
      expect(ran()).toBe(1);

      // Doing the same thing again is a new decision, and needs disclosing
      // again.
      await call();
      expect(ran()).toBe(1);
      await call();
      expect(ran()).toBe(2);
    });
  });
});
