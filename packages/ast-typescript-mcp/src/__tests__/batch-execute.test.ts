import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BatchExecuteHandler } from "../tools/handlers/batch-execute.js";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/batch-execute-test";
const TEST_FILE_DEF = join(TEST_DIR, "definition.ts");
const TEST_FILE_CALL = join(TEST_DIR, "caller.ts");

describe("BatchExecuteHandler", () => {
  let handler: BatchExecuteHandler;

  beforeEach(() => {
    handler = new BatchExecuteHandler();

    // Create test directory and files
    const { mkdirSync } = require("node:fs");
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // Definition file with a function
    writeFileSync(
      TEST_FILE_DEF,
      `export function greet(name: string, age: number): string {
  return \`Hello \${name}, you are \${age}\`;
}
`
    );

    // Caller file with function calls
    writeFileSync(
      TEST_FILE_CALL,
      `import { greet } from "./definition.js";

const msg1 = greet("Alice", 30);
const msg2 = greet("Bob", 25);
`
    );
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_FILE_DEF)) unlinkSync(TEST_FILE_DEF);
    if (existsSync(TEST_FILE_CALL)) unlinkSync(TEST_FILE_CALL);
  });

  it("should preview batch operations without modifying files", async () => {
    const result = await handler.execute({
      operations: [
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_DEF,
            line: 1,
            column: 17,
            new_params: [
              { name: "name", type: "string" },
              { name: "age", type: "number" },
            ],
          },
        },
        {
          tool: "transform_call_site",
          args: {
            file_path: TEST_FILE_CALL,
            line: 3,
            column: 14,
            param_names: ["name", "age"],
          },
        },
        {
          tool: "transform_call_site",
          args: {
            file_path: TEST_FILE_CALL,
            line: 4,
            column: 14,
            param_names: ["name", "age"],
          },
        },
      ],
      mode: "preview",
    });

    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.success).toBe(true);
    expect(data.mode).toBe("preview");
    expect(data.completed).toBe(3);
    expect(data.total).toBe(3);
    expect(data.changes.length).toBe(3);

    // Verify files were NOT modified
    const defContent = readFileSync(TEST_FILE_DEF, "utf-8");
    expect(defContent).toContain("name: string, age: number");
    expect(defContent).not.toContain("{ name, age }");
  });

  it("should execute batch operations and modify files", async () => {
    const result = await handler.execute({
      operations: [
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_DEF,
            line: 1,
            column: 17,
            new_params: [
              { name: "name", type: "string" },
              { name: "age", type: "number" },
            ],
          },
        },
        {
          tool: "transform_call_site",
          args: {
            file_path: TEST_FILE_CALL,
            line: 3,
            column: 14,
            param_names: ["name", "age"],
          },
        },
        {
          tool: "transform_call_site",
          args: {
            file_path: TEST_FILE_CALL,
            line: 4,
            column: 14,
            param_names: ["name", "age"],
          },
        },
      ],
      mode: "execute",
    });

    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.success).toBe(true);
    expect(data.mode).toBe("execute");
    expect(data.completed).toBe(3);

    // Verify definition file was modified
    const defContent = readFileSync(TEST_FILE_DEF, "utf-8");
    expect(defContent).toContain("{ name, age }: { name: string; age: number }");

    // Verify caller file was modified
    const callContent = readFileSync(TEST_FILE_CALL, "utf-8");
    expect(callContent).toContain('greet({ name: "Alice", age: 30 })');
    expect(callContent).toContain('greet({ name: "Bob", age: 25 })');
  });

  it("should stop on error when stop_on_error is true", async () => {
    const result = await handler.execute({
      operations: [
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_DEF,
            line: 1,
            column: 17,
            new_params: [
              { name: "name", type: "string" },
              { name: "age", type: "number" },
            ],
          },
        },
        {
          tool: "transform_call_site",
          args: {
            file_path: TEST_FILE_CALL,
            line: 999, // Invalid line
            column: 14,
            param_names: ["name", "age"],
          },
        },
        {
          tool: "transform_call_site",
          args: {
            file_path: TEST_FILE_CALL,
            line: 4,
            column: 14,
            param_names: ["name", "age"],
          },
        },
      ],
      mode: "preview",
      stop_on_error: true,
    });

    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.success).toBe(false);
    // With two-phase approach: if preparation fails, nothing is applied (safer)
    expect(data.completed).toBe(0);
    expect(data.phase).toBe("preparation"); // Failed during preparation phase
    expect(data.results.length).toBe(1); // Only the error result
    expect(data.results[0].success).toBe(false);
    // Error can be "No function call found" or "Bad line number" depending on ts-morph version
    expect(data.results[0].error).toBeDefined();
  });

  it("should share Project context across operations", async () => {
    // This test verifies that line numbers are correctly tracked
    // even when previous operations modify the file

    // First, add another function to the definition file
    writeFileSync(
      TEST_FILE_DEF,
      `export function greet(name: string, age: number): string {
  return \`Hello \${name}, you are \${age}\`;
}

export function farewell(name: string, age: number): string {
  return \`Goodbye \${name}\`;
}
`
    );

    const result = await handler.execute({
      operations: [
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_DEF,
            line: 1,
            column: 17, // greet
            new_params: [
              { name: "name", type: "string" },
              { name: "age", type: "number" },
            ],
          },
        },
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_DEF,
            line: 5,
            column: 17, // farewell - this line number should still work
            new_params: [
              { name: "name", type: "string" },
              { name: "age", type: "number" },
            ],
          },
        },
      ],
      mode: "execute",
    });

    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.success).toBe(true);
    expect(data.completed).toBe(2);

    // Both functions should be transformed
    const content = readFileSync(TEST_FILE_DEF, "utf-8");
    expect(content).toContain("function greet({ name, age }");
    expect(content).toContain("function farewell({ name, age }");
  });

  it("should transform class methods with multiple params to single object param", async () => {
    // This is the pattern needed for single-params-object ESLint rule compliance
    const TEST_FILE_CLASS = join(TEST_DIR, "handler.ts");

    writeFileSync(
      TEST_FILE_CLASS,
      `export class Handler {
  execute(args: Args, context: Context): Result {
    return { args, context };
  }
}

type Args = { id: string };
type Context = { user: string };
type Result = { args: Args; context: Context };
`
    );

    const result = await handler.execute({
      operations: [
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_CLASS,
            line: 2,
            column: 3, // execute method
            new_params: [
              { name: "args", type: "Args" },
              { name: "context", type: "Context" },
            ],
          },
        },
      ],
      mode: "execute",
    });

    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.success).toBe(true);
    expect(data.completed).toBe(1);

    // Verify method was transformed to use single object param
    const content = readFileSync(TEST_FILE_CLASS, "utf-8");
    expect(content).toContain("execute({ args, context }: { args: Args; context: Context })");

    // Cleanup
    if (existsSync(TEST_FILE_CLASS)) unlinkSync(TEST_FILE_CLASS);
  });

  it("should transform interface method signatures", async () => {
    const TEST_FILE_INTERFACE = join(TEST_DIR, "types.ts");

    writeFileSync(
      TEST_FILE_INTERFACE,
      `export interface FeedbackReader {
  getFeedback(taskId: string, feedbackId: string): Promise<Entry | null>;
  listFeedback(taskId: string): Promise<Entry[]>;
}

type Entry = { id: string };
`
    );

    const result = await handler.execute({
      operations: [
        {
          tool: "transform_signature",
          args: {
            file_path: TEST_FILE_INTERFACE,
            line: 2,
            column: 3,
            new_params: [
              { name: "taskId", type: "string" },
              { name: "feedbackId", type: "string" },
            ],
          },
        },
      ],
      mode: "execute",
    });

    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.success).toBe(true);
    expect(data.completed).toBe(1);

    const content = readFileSync(TEST_FILE_INTERFACE, "utf-8");
    expect(content).toContain("getFeedback({ taskId, feedbackId }: { taskId: string; feedbackId: string })");

    // Cleanup
    if (existsSync(TEST_FILE_INTERFACE)) unlinkSync(TEST_FILE_INTERFACE);
  });
});
