/**
 * The deliberation gate: a run of identical attempts, where the caller's own
 * explanation is part of what "identical" means.
 *
 * Runs are held per key, so what a run tolerates in between is the other half
 * of the contract, and the tests below say both halves: an unrelated operation
 * does not break a run, and nothing but the TTL or a settle ends one.
 */

import { describe, it, expect } from "vitest";
import {
  DeliberationGate,
  DEFAULT_REQUIRED_ATTEMPTS,
  type DeliberationRequest,
} from "../utils/approval/deliberation.js";

const request: DeliberationRequest = {
  operation: "instruction::apply::notes",
  what: "hash-of-the-change",
  explanation: "Adds the retry rule we agreed on to the notes document.",
};

describe("DeliberationGate", () => {
  it("refuses the first attempt", () => {
    const outcome = new DeliberationGate().consider(request);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.attempts).toBe(1);
      expect(outcome.remaining).toBe(1);
      expect(outcome.message).toContain("attempt 1 of 2");
      expect(outcome.message).toContain(request.explanation);
    }
  });

  it("lets the second identical attempt through", () => {
    const gate = new DeliberationGate();

    expect(gate.consider(request).ok).toBe(false);
    const passed = gate.consider(request);
    expect(passed.ok).toBe(true);
    if (passed.ok) expect(passed.attempts).toBe(2);
  });

  it("defaults to two attempts", () => {
    expect(DEFAULT_REQUIRED_ATTEMPTS).toBe(2);
  });

  describe("what counts as the same attempt", () => {
    it.each([
      ["a different explanation", { explanation: "Something else entirely." }],
      ["a reworded explanation", { explanation: "Adds the retry rule to the notes doc." }],
      ["a different operation", { operation: "instruction::apply::other" }],
      ["a different change", { what: "hash-of-a-different-change" }],
    ])("%s starts a new run", (_label, override) => {
      const gate = new DeliberationGate();
      gate.consider(request);

      // The reflex on being refused is to retry with altered arguments. That is
      // the case this gate is built around: altered arguments are a new key.
      const second = gate.consider({ ...request, ...override });

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.attempts).toBe(1);
    });

    it("survives an unrelated operation in between", () => {
      // A caller working through several documents interleaves them. When runs
      // shared one slot this was the case that could never finish: each
      // document's first attempt evicted the other's.
      const gate = new DeliberationGate();

      gate.consider(request);
      gate.consider({ ...request, operation: "instruction::apply::unrelated" });
      const third = gate.consider(request);

      expect(third.ok).toBe(true);
      if (third.ok) expect(third.attempts).toBe(2);
    });

    it("carries several runs at once without mixing them", () => {
      const gate = new DeliberationGate();
      const other = { ...request, operation: "instruction::apply::other" };

      gate.consider(request);
      gate.consider(other);

      expect(gate.consider(request).ok).toBe(true);
      expect(gate.consider(other).ok).toBe(true);
    });
  });

  describe("requiredAttempts", () => {
    it.each([
      [2, [false, true]],
      [3, [false, false, true]],
      [4, [false, false, false, true]],
    ])("with %i, passes only on the last of the run", (requiredAttempts, expected) => {
      const gate = new DeliberationGate({ requiredAttempts });

      expect(expected.map(() => gate.consider(request).ok)).toEqual(expected);
    });

    it("counts down in the message", () => {
      const gate = new DeliberationGate({ requiredAttempts: 3 });

      const first = gate.consider(request);
      const second = gate.consider(request);

      expect(first.ok).toBe(false);
      expect(second.ok).toBe(false);
      if (!first.ok) expect(first.message).toContain("attempt 1 of 3");
      if (!second.ok) expect(second.message).toContain("attempt 2 of 3");
    });

    it("with 1, lets the first attempt through", () => {
      expect(new DeliberationGate({ requiredAttempts: 1 }).consider(request).ok).toBe(true);
    });

    it.each([[0], [-1], [1.5], [Number.NaN]])("rejects %s at construction", (value) => {
      expect(() => new DeliberationGate({ requiredAttempts: value })).toThrow(
        /positive integer/
      );
    });
  });

  describe("expiry", () => {
    it("starts over once the run has gone stale", () => {
      let now = 1_000;
      const gate = new DeliberationGate({ ttlMs: 100, now: () => now });

      gate.consider(request);
      now += 101;
      const second = gate.consider(request);

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.attempts).toBe(1);
    });

    it("accepts a run completed inside the window", () => {
      let now = 1_000;
      const gate = new DeliberationGate({ ttlMs: 100, now: () => now });

      gate.consider(request);
      now += 99;

      expect(gate.consider(request).ok).toBe(true);
    });
  });

  it("does not leave the operation unlocked once the run is settled", () => {
    const gate = new DeliberationGate();

    gate.consider(request);
    const passed = gate.consider(request);
    expect(passed.ok).toBe(true);
    if (passed.ok) gate.settle(passed.key);

    // Passing once does not leave the operation unlocked.
    expect(gate.consider(request).ok).toBe(false);
  });

  it("settles only the run it was given", () => {
    const gate = new DeliberationGate();
    const other = { ...request, operation: "instruction::apply::other" };

    gate.consider(request);
    const passed = gate.consider(request);
    gate.consider(other);
    if (passed.ok) gate.settle(passed.key);

    // The other run is mid-flight and has nothing to do with the settled one.
    expect(gate.consider(other).ok).toBe(true);
  });

  it("resetAllForTesting drops every run", () => {
    const gate = new DeliberationGate();
    const other = { ...request, operation: "instruction::apply::other" };

    gate.consider(request);
    gate.consider(other);
    gate.resetAllForTesting();

    expect(gate.consider(request).ok).toBe(false);
    expect(gate.consider(other).ok).toBe(false);
  });

  it("forgets a run nobody came back to", () => {
    // With runs held per key, the TTL is the only thing that ends one, so the
    // store must not keep growing on half-finished runs.
    let now = 0;
    const gate = new DeliberationGate({ ttlMs: 100, now: () => now });

    gate.consider(request);
    gate.consider({ ...request, operation: "instruction::apply::other" });
    now += 101;

    // Sweeping happens on the next call, so this one both evicts and starts
    // over rather than continuing either stale run.
    expect(gate.consider(request).ok).toBe(false);
    expect(gate.runCountForTesting()).toBe(1);
  });

  it("tells the caller not to route around it", () => {
    const outcome = new DeliberationGate().consider(request);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("Explain to the user");
      expect(outcome.message).toContain("writing the file");
    }
  });

  describe("settling a passed run", () => {
    it("keeps the run standing until the caller settles it", () => {
      const gate = new DeliberationGate();

      gate.consider(request);
      expect(gate.consider(request).ok).toBe(true);
      // Passing is not the same as the work being done. Until the caller says
      // it happened, an identical retry must not be sent back to attempt 1.
      expect(gate.consider(request).ok).toBe(true);
    });

    it("starts over once the run is settled", () => {
      const gate = new DeliberationGate();

      gate.consider(request);
      const passed = gate.consider(request);
      if (passed.ok) gate.settle(passed.key);

      const after = gate.consider(request);

      expect(after.ok).toBe(false);
      expect(after.attempts).toBe(1);
    });
  });
});

/**
 * `run` exists so the settle cannot be lost. `consider`/`settle` by hand leave
 * one behind on every early return between them, and losing one is silent at
 * the time -- so these say what happens on each path rather than that the pair
 * was called.
 */
describe("DeliberationGate.run", () => {
  const ok = { isError: false } as const;
  const failed = { isError: true } as const;
  const succeeded = (r: { isError: boolean }) => !r.isError;
  const onRefused = () => ({ isError: false, refused: true } as const);

  it("does not do the work on the first attempt", async () => {
    const gate = new DeliberationGate();
    let ran = 0;

    const result = await gate.run({
      request,
      work: async () => { ran += 1; return ok; },
      succeeded,
      onRefused,
    });

    expect(ran).toBe(0);
    expect(result).toHaveProperty("refused", true);
  });

  it("does the work on the second, and settles it", async () => {
    const gate = new DeliberationGate();
    let ran = 0;
    const call = () => gate.run({
      request,
      work: async () => { ran += 1; return ok; },
      succeeded,
      onRefused,
    });

    await call();
    await call();
    expect(ran).toBe(1);

    // Settled, so the next identical call starts the explaining over.
    await call();
    expect(ran).toBe(1);
  });

  it("leaves the run standing when the work reports failure", async () => {
    // The caller has already explained itself once. A write that was rejected
    // must not make it explain again.
    const gate = new DeliberationGate();
    let ran = 0;
    const call = (result: { isError: boolean }) => gate.run({
      request,
      work: async () => { ran += 1; return result; },
      succeeded,
      onRefused,
    });

    await call(failed);
    await call(failed);
    expect(ran).toBe(1);

    await call(ok);
    expect(ran).toBe(2);
  });

  it("leaves the run standing when the work throws", async () => {
    // An exception is not a report of failure, it is the absence of one.
    const gate = new DeliberationGate();

    await gate.run({ request, work: async () => ok, succeeded, onRefused });
    await expect(
      gate.run({
        request,
        work: async () => { throw new Error("disk went away"); },
        succeeded,
        onRefused,
      }),
    ).rejects.toThrow("disk went away");

    let ran = 0;
    const result = await gate.run({
      request,
      work: async () => { ran += 1; return ok; },
      succeeded,
      onRefused,
    });

    expect(ran).toBe(1);
    expect(result).not.toHaveProperty("refused");
  });
});
