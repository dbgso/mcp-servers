/**
 * The manager's cache and its failure returns, plus the last few branches in
 * the validators and the deliberation gate.
 *
 * Small things, each of which decides something: whether a second call gets
 * the same instance or a second one loaded from disk, whether a failed
 * transition is reported or swallowed, and what a precondition with no message
 * of its own says to the caller.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { DeliberationGate } from "../utils/approval/deliberation.js";
import {
  WorkflowManager,
  createWorkflowInstance,
  defineWorkflow,
  fieldMinLength,
  stateVisited,
} from "../utils/workflow.js";

type State = "draft" | "done";
interface Context {
  notes: string;
  tags: string[];
}
interface Params {
  action?: string;
  fail?: boolean;
}

const workflow = defineWorkflow<State, Context, Params>({
  id: "manager-edges",
  states: ["draft", "done"],
  initial: "draft",
  transitions: [
    {
      from: ["draft"],
      preconditions: [fieldMinLength<Context, Params>({ field: "tags", min: 1 })],
      action: async () => ({ nextState: "done" }),
    },
  ],
});

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "manager-edges-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

const manager = () =>
  new WorkflowManager<State, Context, Params>({
    definition: workflow,
    persistDir: dir,
    createInitialContext: () => ({ notes: "", tags: ["t"] }),
  });

describe("the manager's instance cache", () => {
  it("returns the same instance the second time", async () => {
    // Otherwise two callers holding the same id would each mutate their own
    // copy and the last save would win.
    const m = manager();

    const first = await m.getOrCreate({ id: "a" });
    const second = await m.getOrCreate({ id: "a" });

    expect(second).toBe(first);
  });

  it("reports a transition that failed its precondition", async () => {
    const m = new WorkflowManager<State, Context, Params>({
      definition: workflow,
      persistDir: dir,
      createInitialContext: () => ({ notes: "", tags: [] }),
    });

    const result = await m.trigger({ id: "b", triggerParams: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it("carries a transition that succeeded", async () => {
    const result = await manager().trigger({ id: "c", triggerParams: {} });

    expect(result.ok).toBe(true);
  });

  it("skips a state file whose name is not a valid id", async () => {
    // A stray file in the persist directory must not take the whole listing
    // down. `%.json` does not survive decodeURIComponent.
    await fs.writeFile(path.join(dir, "%.json"), "{}", "utf-8");
    const m = manager();
    await m.getOrCreate({ id: "real" });
    await (await m.getOrCreate({ id: "real" })).save(path.join(dir, "real.json"));

    const all = await m.listAll();

    expect(all.map((s) => s.id)).toContain("real");
    expect(all.map((s) => s.id)).not.toContain("%");
  });
});

describe("fieldMinLength", () => {
  it("measures an array by its length", async () => {
    const validator = fieldMinLength<Context>({ field: "tags", min: 2 });

    expect(validator.validate({ notes: "", tags: ["a", "b"] })).toBe(true);
    expect(validator.validate({ notes: "", tags: ["a"] })).toBe(false);
  });

  it("measures a string the same way", async () => {
    const validator = fieldMinLength<Context>({ field: "notes", min: 3 });

    expect(validator.validate({ notes: "abc", tags: [] })).toBe(true);
    expect(validator.validate({ notes: "ab", tags: [] })).toBe(false);
  });

  it("refuses anything it cannot measure", async () => {
    const validator = fieldMinLength<{ n: number }>({ field: "n", min: 1 });

    expect(validator.validate({ n: 5 })).toBe(false);
  });
});

describe("stateVisited", () => {
  it("is false for a context the engine has not annotated", async () => {
    // `_visitedStates` is injected at trigger time. A validator called with a
    // bare context must read that as "not visited" rather than throwing.
    const validator = stateVisited<{ x: number }>("review");

    expect(validator.validate({ x: 1 })).toBe(false);
  });

  it("is true once the state is in the list", async () => {
    const validator = stateVisited<{ x: number }>("review");

    expect(
      validator.validate({ x: 1, _visitedStates: ["draft", "review"] } as never)
    ).toBe(true);
  });
});

describe("a precondition with no message of its own", () => {
  it("still says what went wrong", async () => {
    const bare = defineWorkflow<State, Context, Params>({
      id: "bare-precondition",
      states: ["draft", "done"],
      initial: "draft",
      transitions: [
        {
          from: ["draft"],
          // No `failedMessage`, so the engine has to supply the wording.
          preconditions: [{ validate: () => false, getMessage: () => undefined as unknown as string }],
          action: async () => ({ nextState: "done" }),
        },
      ],
    });
    const instance = createWorkflowInstance({
      definition: bare,
      initialContext: { notes: "", tags: [] },
    });

    const result = await instance.trigger({ params: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe("precondition_failed");
      expect(result.error).toBe("Precondition failed");
    }
  });
});

describe("a deliberation run that was left too long", () => {
  it("starts over rather than counting the old attempt", async () => {
    // The TTL is what bounds a run nobody came back to. Without this, an
    // attempt from an hour ago would still be attempt one of two.
    let now = 1_000;
    const gate = new DeliberationGate({ requiredAttempts: 2, ttlMs: 100, now: () => now });
    const request = { operation: "op", what: "the change", explanation: "because" };

    expect(gate.consider(request).ok).toBe(false);
    now += 200;

    // Still refused: this is attempt one of a new run, not attempt two.
    expect(gate.consider(request).ok).toBe(false);
    expect(gate.consider(request).ok).toBe(true);
  });
});
