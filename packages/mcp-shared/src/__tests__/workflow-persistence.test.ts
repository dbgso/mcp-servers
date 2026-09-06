/**
 * Persistence round-tripping for WorkflowManager.
 *
 * These cover the seam between the name `save()` writes and the name the
 * manager reads back. They used to disagree -- `save()` wrote the raw id while
 * the manager looked for the id with `__` collapsed to `_` -- so any id
 * containing `__` silently rewound to its initial state on every reload, and
 * `listAll()` handed back ids that no document had.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  defineWorkflow,
  WorkflowManager,
  workflowStateFileName,
  instanceIdFromStateFileName,
  type WorkflowDefinition,
} from "../utils/workflow.js";

type State = "a" | "b" | "c";
interface Context {
  id: string;
  marks: string[];
}
interface Params {
  mark?: string;
}

const definition: WorkflowDefinition<State, Context, Params> = defineWorkflow({
  id: "persistence-test",
  states: ["a", "b", "c"],
  initial: "a",
  transitions: [
    {
      from: ["a"],
      action: async (ctx, params) => {
        if (params.mark) ctx.marks.push(params.mark);
        return { nextState: "b" };
      },
    },
    {
      from: ["b"],
      action: async (ctx, params) => {
        if (params.mark) ctx.marks.push(params.mark);
        return { nextState: "c" };
      },
    },
  ],
});

let persistDir: string;

function newManager(dir = persistDir): WorkflowManager<State, Context, Params> {
  return new WorkflowManager<State, Context, Params>({
    definition,
    persistDir: dir,
    createInitialContext: (id) => ({ id, marks: [] }),
  });
}

beforeEach(async () => {
  persistDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-persistence-"));
});

afterEach(async () => {
  await fs.rm(persistDir, { recursive: true, force: true });
});

describe("workflowStateFileName", () => {
  it.each([
    ["plain", "doc"],
    ["single underscore", "my_draft"],
    ["hierarchy separator", "ns__doc"],
    ["draft prefix", "_mcp_drafts__coding__testing"],
    ["adjacent shapes", "a_b"],
    ["non-ascii", "設計"],
    ["path-ish", "a/b"],
  ])("round-trips a %s id", (_label, id) => {
    expect(instanceIdFromStateFileName(workflowStateFileName(id))).toBe(id);
  });

  it("never produces a path separator", () => {
    expect(workflowStateFileName("a/b/../c")).not.toContain("/");
  });

  it("maps distinct ids that differ only in underscores to distinct files", () => {
    expect(workflowStateFileName("a_b")).not.toBe(workflowStateFileName("a__b"));
  });

  it("rejects a filename it did not write", () => {
    expect(instanceIdFromStateFileName("notes.txt")).toBeNull();
  });
});

describe("WorkflowManager persistence", () => {
  it.each([
    ["an id with __", "ns__doc"],
    ["an id with a single _", "my_draft"],
    ["the draft-prefix shape", "_mcp_drafts__coding__testing"],
    ["a plain id", "guide"],
  ])("restores state across a restart for %s", async (_label, id) => {
    await newManager().trigger({ id, triggerParams: { mark: "first" } });

    const restored = await newManager().getStatus({ id });
    expect(restored?.state).toBe("b");
    expect(restored?.context.marks).toEqual(["first"]);
  });

  it("keeps saving into the configured persistDir after a reload", async () => {
    const id = "ns__doc";
    await newManager().trigger({ id, triggerParams: { mark: "first" } });

    // Second manager reloads from disk, then advances.
    const second = newManager();
    const advanced = await second.trigger({ id, triggerParams: { mark: "second" } });
    expect(advanced.ok).toBe(true);

    // A third manager over the same dir must see the second manager's write.
    // Before the fix the reloaded instance saved to the module default dir, so
    // this read the pre-reload snapshot forever.
    const third = await newManager().getStatus({ id });
    expect(third?.state).toBe("c");
    expect(third?.context.marks).toEqual(["first", "second"]);

    const files = await fs.readdir(persistDir);
    expect(files).toEqual([workflowStateFileName(id)]);
  });

  it("lists persisted workflows under their real ids", async () => {
    const manager = newManager();
    await manager.trigger({ id: "my_draft", triggerParams: {} });
    await manager.trigger({ id: "ns__doc", triggerParams: {} });

    const listed = (await newManager().listAll()).map((w) => w.id).sort();
    expect(listed).toEqual(["my_draft", "ns__doc"]);
  });

  it("ignores files it did not write", async () => {
    await newManager().trigger({ id: "ns__doc", triggerParams: {} });
    await fs.writeFile(path.join(persistDir, "README.md"), "not a workflow", "utf-8");
    await fs.writeFile(path.join(persistDir, "junk.json"), "{}", "utf-8");

    const listed = await newManager().listAll();
    expect(listed.map((w) => w.id)).toEqual(["ns__doc"]);
  });

  it("delete removes the file save wrote", async () => {
    const id = "ns__doc";
    const manager = newManager();
    await manager.trigger({ id, triggerParams: {} });
    expect(await fs.readdir(persistDir)).toEqual([workflowStateFileName(id)]);

    await manager.delete({ id });

    expect(await fs.readdir(persistDir)).toEqual([]);
    // And the state is genuinely gone, not just uncached.
    expect((await newManager().getStatus({ id }))?.state).toBe("a");
  });
});
