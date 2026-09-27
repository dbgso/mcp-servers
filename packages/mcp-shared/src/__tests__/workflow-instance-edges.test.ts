/**
 * The workflow instance's accessors and its read failures.
 *
 * What was uncovered: `workflowId`, the defensive copies behind `context` and
 * `visitedStates`, `canTrigger` with nothing to trigger, an action that
 * returns a state the definition does not declare, and the difference between
 * "the file is not there" and "the file could not be read". The last one
 * decides whether a caller starts a new workflow or reports a problem.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { createWorkflowInstance, defineWorkflow, loadWorkflowInstance } from "../utils/workflow.js";

type State = "draft" | "done";
interface Context {
  items: string[];
}
interface Params {
  action?: string;
  to?: string;
}

const workflow = defineWorkflow<State, Context, Params>({
  id: "edges",
  states: ["draft", "done"],
  initial: "draft",
  transitions: [
    {
      from: ["draft"],
      action: async (ctx, params) => {
        ctx.items.push("ran");
        return { nextState: (params?.to ?? "done") as State };
      },
    },
  ],
});

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-edges-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("what an instance reports about itself", () => {
  it("names the workflow it was defined by", () => {
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });

    expect(instance.workflowId).toBe("edges");
    expect(instance.id).toBeTruthy();
    expect(instance.state).toBe("draft");
  });

  it("hands out a copy of the context, not the context", async () => {
    // A caller that mutates what it reads would otherwise be editing the
    // workflow's own state without a transition.
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });

    const seen = instance.context;
    seen.items.push("tampered");

    expect(instance.context.items).toEqual([]);
  });

  it("hands out a copy of the visited states too", async () => {
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });

    instance.visitedStates.push("done");

    expect(instance.visitedStates).toEqual(["draft"]);
  });

  it("records each state it has been in, once", async () => {
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });

    await instance.trigger({ params: {} });

    expect(instance.visitedStates).toEqual(["draft", "done"]);
  });
});

describe("canTrigger", () => {
  it("says why there is nothing to trigger from a terminal state", () => {
    const instance = createWorkflowInstance({
      definition: workflow,
      initialContext: { items: [] },
      options: { restoredState: "done" },
    });

    const result = instance.canTrigger({});

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No transition defined for state "done"');
  });

  it("allows what the definition allows", () => {
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });

    expect(instance.canTrigger({}).allowed).toBe(true);
  });
});

describe("an action that misbehaves", () => {
  it("is refused when it returns a state the definition does not declare", async () => {
    // Accepting it would leave the instance in a state no transition matches,
    // which is a workflow that cannot be moved or diagnosed.
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });

    const result = await instance.trigger({ params: { to: "nowhere" } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe("action_failed");
      expect(result.error).toContain('invalid state "nowhere"');
    }
    expect(instance.state).toBe("draft");
  });
});

describe("loadWorkflowInstance", () => {
  it("tells a missing file apart from an unreadable one", async () => {
    // A caller seeing file_not_found starts a new workflow; one seeing
    // read_error has something to fix.
    const missing = await loadWorkflowInstance({
      definition: workflow,
      filePath: path.join(dir, "absent.json"),
    });

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errorType).toBe("file_not_found");
  });

  it("reports a read error for something that is not a file", async () => {
    const asDirectory = await loadWorkflowInstance({ definition: workflow, filePath: dir });

    expect(asDirectory.ok).toBe(false);
    if (!asDirectory.ok) {
      expect(asDirectory.errorType).toBe("read_error");
      expect(asDirectory.error).toContain("Failed to read file");
    }
  });

  it("reports unreadable JSON rather than throwing", async () => {
    const filePath = path.join(dir, "broken.json");
    await fs.writeFile(filePath, "{not json", "utf-8");

    const result = await loadWorkflowInstance({ definition: workflow, filePath });

    expect(result.ok).toBe(false);
  });

  it("restores a saved instance", async () => {
    const instance = createWorkflowInstance({ definition: workflow, initialContext: { items: [] } });
    await instance.trigger({ params: {} });
    const filePath = path.join(dir, "saved.json");
    await instance.save(filePath);

    const loaded = await loadWorkflowInstance({ definition: workflow, filePath });

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.instance.state).toBe("done");
      expect(loaded.instance.visitedStates).toEqual(["draft", "done"]);
      expect(loaded.instance.context.items).toEqual(["ran"]);
    }
  });
});
