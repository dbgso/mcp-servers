import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createOperationRegistry,
  createDescribeExecuteHandlers,
  type Operation,
} from "../tools/index.js";
import { jsonResponse } from "../utils/mcp-response.js";

interface TestCtx {
  prefix: string;
}

const echoOp: Operation<{ message: string }, TestCtx> = {
  id: "echo",
  summary: "Echo a message back",
  detail: "Returns the input prefixed with the context prefix.",
  category: "Demo",
  argsSchema: z.object({ message: z.string() }),
  execute: async ({ args, ctx }) =>
    jsonResponse({ echoed: `${ctx.prefix}${args.message}` }),
};

const addOp: Operation<{ a: number; b: number }, TestCtx> = {
  id: "add",
  summary: "Add two numbers",
  detail: "Returns a + b.",
  category: "Math",
  argsSchema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ args }) => jsonResponse({ sum: args.a + args.b }),
};

function buildHandlers(buildContext: () => TestCtx | Promise<TestCtx> = () => ({ prefix: "[" })) {
  const registry = createOperationRegistry<TestCtx>([
    echoOp as Operation<unknown, TestCtx>,
    addOp as Operation<unknown, TestCtx>,
  ]);
  return createDescribeExecuteHandlers({
    prefix: "test",
    registry,
    buildContext,
  });
}

describe("createDescribeExecuteHandlers", () => {
  it("describe lists all operations grouped by category", async () => {
    const [describe] = buildHandlers();
    const result = await describe.execute({});
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("# Test Operations");
    expect(text).toContain("## Demo");
    expect(text).toContain("## Math");
    expect(text).toContain("**echo**");
    expect(text).toContain("**add**");
  });

  it("describe returns single op detail with arg schema", async () => {
    const [describe] = buildHandlers();
    const result = await describe.execute({ operation: "echo" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("# echo");
    expect(text).toContain("Echo a message back");
    expect(text).toContain("```json");
  });

  it("describe returns error for unknown op", async () => {
    const [describe] = buildHandlers();
    const result = await describe.execute({ operation: "missing" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Unknown operation");
  });

  it("execute routes to the right operation and passes context", async () => {
    const [, execute] = buildHandlers();
    const result = await execute.execute({
      operation: "echo",
      params: { message: "hello" },
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.echoed).toBe("[hello");
  });

  it("execute validates params via the op's zod schema", async () => {
    const [, execute] = buildHandlers();
    const result = await execute.execute({
      operation: "add",
      params: { a: 1, b: "not a number" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Invalid params");
  });

  it("execute returns error for unknown op", async () => {
    const [, execute] = buildHandlers();
    const result = await execute.execute({ operation: "missing", params: {} });
    expect(result.isError).toBe(true);
  });

  it("an empty prefix yields bare tool names", async () => {
    const registry = createOperationRegistry<TestCtx>([echoOp as Operation<unknown, TestCtx>]);
    const [describeHandler, executeHandler] = createDescribeExecuteHandlers({
      prefix: "",
      registry,
      buildContext: () => ({ prefix: "[" }),
    });

    expect(describeHandler.name).toBe("describe");
    expect(executeHandler.name).toBe("execute");
    expect(executeHandler.description).toContain("Execute an operation");

    const text = (await describeHandler.execute({})).content[0] as { text: string };
    expect(text.text).toContain("# Operations");
    expect(text.text).toContain("Use `execute` with");
  });

  it("buildContext is called per execute (lazy)", async () => {
    let calls = 0;
    const [, execute] = buildHandlers(() => {
      calls++;
      return { prefix: `${calls}:` };
    });
    await execute.execute({ operation: "echo", params: { message: "a" } });
    await execute.execute({ operation: "echo", params: { message: "b" } });
    expect(calls).toBe(2);
  });
});
