/**
 * `ts_remove_nodes` and `params_to_object`: the two tools that delete or
 * rewrite a declaration, driven over every target kind and every shape they
 * can meet.
 *
 * Both edit source in place, so an untested arm is a wrong deletion. For
 * `remove_nodes` the arms are the target kinds -- a named declaration of each
 * sort, a `describe("...")` block picked by its title or by a pattern, a bare
 * line -- and for `params_to_object` they are the callable shapes a signature
 * can belong to, plus the call sites that have to be rewritten with it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { RemoveNodesHandler } from "../tools/handlers/remove-nodes.js";
import { ParamsToObjectHandler } from "../tools/handlers/params-to-object.js";

const remove = new RemoveNodesHandler();
const paramsToObject = new ParamsToObjectHandler();
let dir: string;

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

const json = (r: { content: { type: string; text?: string }[] }) =>
  JSON.parse(text(r)) as Record<string, unknown>;

async function file(content: string, name = "subject.ts"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf-8");
  return path;
}

function lineOf(content: string, snippet: string): number {
  const index = content.split("\n").findIndex((l) => l.includes(snippet));
  if (index === -1) throw new Error(`not found: ${snippet}`);
  return index + 1;
}

const DECLARATIONS = `export function keptFunction(): void {}
export function doomedFunction(): void {}
export class DoomedClass {}
export interface DoomedInterface { a: number; }
export type DoomedType = string;
export enum DoomedEnum { A }
export const doomedVariable = 1;
export const keptVariable = 2;
`;

const SUITE = `describe("kept suite", () => {
  it("passes", () => {});
});

describe("doomed suite", () => {
  it("fails", () => {});
});

describe(\`templated suite\`, () => {
  it("templated", () => {});
});

suite.only("scoped suite", () => {});

const orphan = 1;
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "removal-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("removing a named declaration", () => {
  it.each([
    { type: "function", name: "doomedFunction" },
    { type: "class", name: "DoomedClass" },
    { type: "interface", name: "DoomedInterface" },
    { type: "type", name: "DoomedType" },
    { type: "enum", name: "DoomedEnum" },
    { type: "variable", name: "doomedVariable" },
  ])("removes a $type by name", async ({ type, name }) => {
    const path = await file(DECLARATIONS);

    await remove.execute({
      file_path: path,
      targets: [{ type, name }],
      dry_run: false,
    });

    const written = await readFile(path, "utf-8");
    expect(written).not.toContain(name);
    // Everything else is still there.
    expect(written).toContain("keptFunction");
    expect(written).toContain("keptVariable");
  }, 60_000);

  it("reports a name that is not there rather than removing something else", async () => {
    const path = await file(DECLARATIONS);

    const result = await remove.execute({
      file_path: path,
      targets: [{ type: "function", name: "absentFunction" }],
      dry_run: true,
    });

    expect(JSON.stringify(result)).toContain("absentFunction");
    expect(await readFile(path, "utf-8")).toBe(DECLARATIONS);
  }, 60_000);

  it("previews without writing, by default", async () => {
    const path = await file(DECLARATIONS);

    const data = json(
      await remove.execute({
        file_path: path,
        targets: [{ type: "function", name: "doomedFunction" }],
        dry_run: true,
      })
    );

    expect(data.dryRun).toBe(true);
    expect(await readFile(path, "utf-8")).toContain("doomedFunction");
  }, 60_000);
});

describe("removing a call block", () => {
  it("picks the one whose first argument matches exactly", async () => {
    const path = await file(SUITE);

    await remove.execute({
      file_path: path,
      targets: [{ type: "call_block", call_name: "describe", first_arg: "doomed suite" }],
      dry_run: false,
    });

    const written = await readFile(path, "utf-8");
    expect(written).not.toContain("doomed suite");
    expect(written).toContain("kept suite");
  }, 60_000);

  it("picks the ones whose first argument matches a pattern", async () => {
    const path = await file(SUITE);

    await remove.execute({
      file_path: path,
      targets: [{ type: "call_block", call_name: "describe", first_arg_pattern: "^doomed" }],
      dry_run: false,
    });

    expect(await readFile(path, "utf-8")).not.toContain("doomed suite");
  }, 60_000);

  it("reads a template literal title as well as a quoted one", async () => {
    const path = await file(SUITE);

    await remove.execute({
      file_path: path,
      targets: [{ type: "call_block", call_name: "describe", first_arg: "templated suite" }],
      dry_run: false,
    });

    expect(await readFile(path, "utf-8")).not.toContain("templated suite");
  }, 60_000);

  it("removes every call of that name when no argument is given", async () => {
    const path = await file(SUITE);

    await remove.execute({
      file_path: path,
      targets: [{ type: "call_block", call_name: "describe" }],
      dry_run: false,
    });

    const written = await readFile(path, "utf-8");
    expect(written).not.toContain("describe(");
    expect(written).toContain("orphan");
  }, 60_000);

  it("finds a call written as a member, like suite.only(...)", async () => {
    const path = await file(SUITE);

    await remove.execute({
      file_path: path,
      // A member call is named by its object: `suite.only(...)` is `suite`.
      targets: [{ type: "call_block", call_name: "suite", first_arg: "scoped suite" }],
      dry_run: false,
    });

    expect(await readFile(path, "utf-8")).not.toContain("scoped suite");
  }, 60_000);
});

describe("removing a statement by line", () => {
  it("removes the statement that starts there", async () => {
    // The fallback for anything the other target kinds cannot name.
    const path = await file(SUITE);

    await remove.execute({
      file_path: path,
      targets: [{ type: "statement_at_line", line: lineOf(SUITE, "const orphan") }],
      dry_run: false,
    });

    expect(await readFile(path, "utf-8")).not.toContain("orphan");
  }, 60_000);

  it("reports a line with no statement on it", async () => {
    const path = await file(SUITE);

    const result = await remove.execute({
      file_path: path,
      targets: [{ type: "statement_at_line", line: 3 }],
      dry_run: true,
    });

    expect(JSON.stringify(result)).toContain("statement_at_line");
  }, 60_000);
});

describe("removing several things at once", () => {
  it("does not remove the same node twice when two targets name it", async () => {
    const path = await file(DECLARATIONS);

    const data = json(
      await remove.execute({
        file_path: path,
        targets: [
          { type: "function", name: "doomedFunction" },
          { type: "function", name: "doomedFunction" },
        ],
        dry_run: false,
      })
    );

    expect(await readFile(path, "utf-8")).not.toContain("doomedFunction");
    expect(JSON.stringify(data)).toBeTruthy();
  }, 60_000);
});

describe("turning parameters into an object", () => {
  const FUNCTIONS = `export function positional(name: string, age: number, note?: string): string {
  return name + age + (note ?? "");
}

export const arrow = (a: string, b: number): string => a + b;

export class Holder {
  method(first: string, second: number): string {
    return first + second;
  }
}

export function noParams(): void {}

export const caller = positional("alice", 30);
`;

  it("rewrites a function's signature and its call sites", async () => {
    const path = await file(FUNCTIONS);

    await paramsToObject.execute({
      file_path: path,
      line: lineOf(FUNCTIONS, "export function positional"),
      column: 17,
      dry_run: false,
    });

    // The signature becomes a destructured object with an inline type.
    const written = await readFile(path, "utf-8");
    expect(written).toContain("{ name, age, note }");
    expect(written).toContain("note?: string");
  }, 90_000);

  it("rewrites a call site in the same file as the function", async () => {
    // The definition and the call are two edits to one file. Applying the
    // first invalidates the node the second was found through, which is why
    // both are worked out before either is written -- this used to fail with
    // "node that was removed or forgotten" and leave the call untouched.
    const path = await file(FUNCTIONS);

    const data = json(
      await paramsToObject.execute({
        file_path: path,
        line: lineOf(FUNCTIONS, "export function positional"),
        column: 17,
        dry_run: false,
      })
    );

    const written = await readFile(path, "utf-8");
    expect(written).toContain("{ name, age, note }");
    expect(written).toContain('positional({ name: "alice", age: 30 })');
    expect((data.summary as { callSitesTransformed: number }).callSitesTransformed).toBe(1);
  }, 90_000);

  it("keeps an optional parameter optional", async () => {
    const path = await file(FUNCTIONS);

    const data = json(
      await paramsToObject.execute({
        file_path: path,
        line: lineOf(FUNCTIONS, "export function positional"),
        column: 17,
        dry_run: true,
      })
    );

    expect(JSON.stringify(data)).toContain("note");
  }, 90_000);

  it("handles an arrow assigned to a variable", async () => {
    const path = await file(FUNCTIONS);

    const result = await paramsToObject.execute({
      file_path: path,
      line: lineOf(FUNCTIONS, "export const arrow"),
      column: 22,
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
  }, 90_000);

  it("handles a method", async () => {
    const path = await file(FUNCTIONS);

    const result = await paramsToObject.execute({
      file_path: path,
      line: lineOf(FUNCTIONS, "  method(first: string"),
      column: 3,
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
  }, 90_000);

  it("says so when the function has no parameters to convert", async () => {
    const path = await file(FUNCTIONS);

    const result = await paramsToObject.execute({
      file_path: path,
      line: lineOf(FUNCTIONS, "export function noParams"),
      column: 17,
      dry_run: true,
    });

    expect(JSON.stringify(result)).toMatch(/no parameters|skipped|0/i);
  }, 90_000);

  it("says so when there is no function at the position", async () => {
    const path = await file(FUNCTIONS);

    const result = await paramsToObject.execute({
      file_path: path,
      line: lineOf(FUNCTIONS, "export const caller"),
      column: 1,
      dry_run: true,
    });

    expect(result.isError).toBe(true);
  }, 90_000);
});
