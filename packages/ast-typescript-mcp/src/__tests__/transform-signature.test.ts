import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TransformSignatureHandler } from "../tools/handlers/transform-signature.js";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/transform-signature-test";

describe("TransformSignatureHandler", () => {
  let handler: TransformSignatureHandler;

  beforeEach(() => {
    handler = new TransformSignatureHandler();
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup test files
    const files = ["function.ts", "method.ts", "arrow.ts", "expression.ts", "interface.ts", "edge.ts"];
    for (const file of files) {
      const path = join(TEST_DIR, file);
      if (existsSync(path)) unlinkSync(path);
    }
  });

  describe("FunctionDeclaration", () => {
    it("should transform function declaration parameters", async () => {
      const filePath = join(TEST_DIR, "function.ts");
      writeFileSync(filePath, `export function greet(name: string, age: number): string {
  return \`Hello \${name}, age \${age}\`;
}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 17,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);
      expect(data.functionName).toBe("greet");

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("{ name, age }: { name: string; age: number }");
    });
  });

  describe("MethodDeclaration", () => {
    it("should transform class method parameters", async () => {
      const filePath = join(TEST_DIR, "method.ts");
      writeFileSync(filePath, `export class Greeter {
  greet(name: string, age: number): string {
    return \`Hello \${name}\`;
  }
}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 2,
        column: 3,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);
      expect(data.functionName).toBe("greet");

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("greet({ name, age }: { name: string; age: number })");
    });
  });

  describe("ArrowFunction", () => {
    it("should transform arrow function parameters", async () => {
      const filePath = join(TEST_DIR, "arrow.ts");
      writeFileSync(filePath, `export const greet = (name: string, age: number): string => {
  return \`Hello \${name}\`;
};
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 22,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("({ name, age }: { name: string; age: number })");
    });
  });

  describe("FunctionExpression", () => {
    it("should transform function expression parameters", async () => {
      const filePath = join(TEST_DIR, "expression.ts");
      writeFileSync(filePath, `export const greet = function(name: string, age: number): string {
  return \`Hello \${name}\`;
};
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 22,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("function({ name, age }: { name: string; age: number })");
    });
  });

  describe("MethodSignature", () => {
    it("should transform interface method signature parameters", async () => {
      const filePath = join(TEST_DIR, "interface.ts");
      writeFileSync(filePath, `export interface Greeter {
  greet(name: string, age: number): string;
  farewell(name: string): void;
}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 2,
        column: 3,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);
      expect(data.functionName).toBe("greet");

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("greet({ name, age }: { name: string; age: number })");
      // Ensure other methods are not affected
      expect(content).toContain("farewell(name: string)");
    });

    it("should handle interface method with complex types", async () => {
      const filePath = join(TEST_DIR, "interface.ts");
      writeFileSync(filePath, `export interface Reader {
  read(path: string, options: ReadOptions): Promise<Buffer>;
}

type ReadOptions = { encoding: string };
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 2,
        column: 3,
        new_params: [
          { name: "path", type: "string" },
          { name: "options", type: "ReadOptions" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("read({ path, options }: { path: string; options: ReadOptions })");
    });
  });

  describe("CallSignature", () => {
    it("should transform callable interface signature", async () => {
      const filePath = join(TEST_DIR, "interface.ts");
      writeFileSync(filePath, `export interface Handler {
  (request: Request, response: Response): void;
}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 2,
        column: 3,
        new_params: [
          { name: "request", type: "Request" },
          { name: "response", type: "Response" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("({ request, response }: { request: Request; response: Response })");
    });
  });

  describe("ConstructSignature", () => {
    it("should transform constructor signature in interface", async () => {
      const filePath = join(TEST_DIR, "interface.ts");
      writeFileSync(filePath, `export interface Factory {
  new(name: string, options: Options): Instance;
}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 2,
        column: 3,
        new_params: [
          { name: "name", type: "string" },
          { name: "options", type: "Options" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("new({ name, options }: { name: string; options: Options })");
    });
  });

  describe("FunctionTypeNode", () => {
    it("should transform function type alias", async () => {
      const filePath = join(TEST_DIR, "interface.ts");
      writeFileSync(filePath, `export type Handler = (request: Request, response: Response) => void;
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 23,
        new_params: [
          { name: "request", type: "Request" },
          { name: "response", type: "Response" },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("({ request, response }: { request: Request; response: Response }) => void");
    });
  });

  describe("Edge Cases", () => {
    it("should return error for function with no parameters", async () => {
      const filePath = join(TEST_DIR, "edge.ts");
      writeFileSync(filePath, `export function noParams(): void {}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 17,
        new_params: [],
        dry_run: false,
      });

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("no parameters");
    });

    it("should handle optional parameters", async () => {
      const filePath = join(TEST_DIR, "edge.ts");
      writeFileSync(filePath, `export function greet(name: string, age?: number): string {
  return name;
}
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 17,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number", optional: true },
        ],
        dry_run: false,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("{ name, age }: { name: string; age?: number }");
    });

    it("should preview without modifying when dry_run is true", async () => {
      const filePath = join(TEST_DIR, "edge.ts");
      const original = `export function greet(name: string, age: number): string {
  return name;
}
`;
      writeFileSync(filePath, original);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 17,
        new_params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        dry_run: true,
      });

      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.modified).toBe(false);
      expect(data.before).toBe("(name: string, age: number)");
      expect(data.after).toBe("({ name, age }: { name: string; age: number })");

      // File should not be modified
      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe(original);
    });

    it("should return error for invalid position", async () => {
      const filePath = join(TEST_DIR, "edge.ts");
      writeFileSync(filePath, `const x = 1;
`);

      const result = await handler.execute({
        file_path: filePath,
        line: 1,
        column: 1,
        new_params: [{ name: "x", type: "number" }],
        dry_run: false,
      });

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("No function found");
    });
  });
});
