/**
 * The deliberation gate: a run of consecutive identical attempts, where the
 * caller's own explanation is part of what "identical" means.
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
    expect(gate.consider(request)).toEqual({ ok: true, attempts: 2 });
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

    it("requires the attempts to be consecutive", () => {
      const gate = new DeliberationGate();

      gate.consider(request);
      gate.consider({ ...request, operation: "instruction::apply::unrelated" });
      const third = gate.consider(request);

      expect(third.ok).toBe(false);
      if (!third.ok) expect(third.attempts).toBe(1);
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
    expect(gate.consider(request).ok).toBe(true);
    gate.settle();

    // Passing once does not leave the operation unlocked.
    expect(gate.consider(request).ok).toBe(false);
  });

  it("reset drops a run in progress", () => {
    const gate = new DeliberationGate();

    gate.consider(request);
    gate.reset();

    expect(gate.consider(request).ok).toBe(false);
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
      gate.consider(request);
      gate.settle();

      const after = gate.consider(request);

      expect(after.ok).toBe(false);
      expect(after.attempts).toBe(1);
    });
  });
});
