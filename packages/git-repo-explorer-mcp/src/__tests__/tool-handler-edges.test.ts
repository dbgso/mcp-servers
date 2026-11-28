/**
 * What `git_describe` and `git_execute` do with an operation name or an
 * argument set they cannot use.
 *
 * These two handlers are the whole tool surface -- every operation is reached
 * through `git_execute` -- so the answer to a name that does not exist, and to
 * arguments that do not fit the operation's schema, is what a caller sees when
 * they get something wrong. Both had only their happy paths run.
 */

import { describe, it, expect } from "vitest";
import { GitDescribeHandler } from "../tools/handlers/describe.js";
import { GitExecuteHandler } from "../tools/handlers/execute.js";

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

describe("git_describe", () => {
  it("lists the operations when asked for no particular one", async () => {
    const result = await new GitDescribeHandler().execute({});

    expect(text(result)).toContain("grep");
    expect(text(result)).toContain("log");
  });

  it("describes one operation when named", async () => {
    const result = await new GitDescribeHandler().execute({ operation: "grep" });

    expect(text(result)).toContain("grep");
  });

  it("names the ones it has when asked for one it does not", async () => {
    const result = await new GitDescribeHandler().execute({ operation: "nonesuch" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("nonesuch");
    expect(text(result)).toContain("grep");
  });
});

describe("git_execute", () => {
  it("refuses an operation it does not have, and says what is available", async () => {
    const result = await new GitExecuteHandler().execute({
      operation: "nonesuch",
      params: {},
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("nonesuch");
  });

  it("reports which argument is wrong rather than running the command", async () => {
    // `grep` needs a pattern. Running git without one would fail somewhere
    // deeper, with a message about git rather than about the call.
    const result = await new GitExecuteHandler().execute({
      operation: "grep",
      params: {},
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/pattern|required|Validation/i);
  });
});
