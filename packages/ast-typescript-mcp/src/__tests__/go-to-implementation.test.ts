import { describe, it, expect, beforeAll } from "vitest";
import { TypeScriptHandler } from "../handlers/typescript.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures/implementation");

describe("goToImplementation", () => {
  let handler: TypeScriptHandler;

  beforeAll(() => {
    handler = new TypeScriptHandler();

    // Create test fixtures
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // Interface with implementations
    writeFileSync(
      join(FIXTURES_DIR, "interface.ts"),
      `export interface Handler {
  handle(): void;
}
`
    );

    writeFileSync(
      join(FIXTURES_DIR, "impl-a.ts"),
      `import { Handler } from "./interface.js";

export class HandlerA implements Handler {
  handle(): void {
    console.log("A");
  }
}
`
    );

    writeFileSync(
      join(FIXTURES_DIR, "impl-b.ts"),
      `import { Handler } from "./interface.js";

export class HandlerB implements Handler {
  handle(): void {
    console.log("B");
  }
}
`
    );

    // Abstract class with derived classes
    writeFileSync(
      join(FIXTURES_DIR, "abstract.ts"),
      `export abstract class BaseService {
  abstract execute(): string;
}
`
    );

    writeFileSync(
      join(FIXTURES_DIR, "derived.ts"),
      `import { BaseService } from "./abstract.js";

export class ConcreteService extends BaseService {
  execute(): string {
    return "done";
  }
}
`
    );

    // tsconfig for the fixtures
    writeFileSync(
      join(FIXTURES_DIR, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
          strict: true,
        },
        include: ["./*.ts"],
      })
    );
  });

  describe("interface implementations", () => {
    it("should find classes implementing an interface", async () => {
      const result = await handler.goToImplementation({
        filePath: join(FIXTURES_DIR, "interface.ts"),
        line: 1,
        column: 18, // "Handler" in "export interface Handler"
      });

      expect(result.identifier).toBe("Handler");
      expect(result.sourceKind).toBe("interface");
      expect(result.implementations.length).toBeGreaterThanOrEqual(2);

      const names = result.implementations.map((i) => i.name);
      expect(names).toContain("HandlerA");
      expect(names).toContain("HandlerB");
    });

    it("should return empty array for interface with no implementations", async () => {
      writeFileSync(
        join(FIXTURES_DIR, "lonely-interface.ts"),
        `export interface Lonely { value: number; }`
      );

      const result = await handler.goToImplementation({
        filePath: join(FIXTURES_DIR, "lonely-interface.ts"),
        line: 1,
        column: 18,
      });

      expect(result.sourceKind).toBe("interface");
      expect(result.implementations).toEqual([]);
    });
  });

  describe("abstract class implementations", () => {
    it("should find classes extending an abstract class", async () => {
      const result = await handler.goToImplementation({
        filePath: join(FIXTURES_DIR, "abstract.ts"),
        line: 1,
        column: 23, // "BaseService" in "export abstract class BaseService"
      });

      expect(result.identifier).toBe("BaseService");
      expect(result.sourceKind).toBe("abstract class");
      expect(result.implementations.length).toBeGreaterThanOrEqual(1);

      const names = result.implementations.map((i) => i.name);
      expect(names).toContain("ConcreteService");
    });
  });

  describe("non-implementable symbols", () => {
    it("should return empty implementations for regular class", async () => {
      writeFileSync(
        join(FIXTURES_DIR, "regular-class.ts"),
        `export class RegularClass { foo() {} }`
      );

      const result = await handler.goToImplementation({
        filePath: join(FIXTURES_DIR, "regular-class.ts"),
        line: 1,
        column: 14, // "RegularClass"
      });

      // Regular (non-abstract) classes don't have implementations
      expect(result.implementations).toEqual([]);
    });

    it("should return unknown sourceKind for non-identifier nodes", async () => {
      const result = await handler.goToImplementation({
        filePath: join(FIXTURES_DIR, "interface.ts"),
        line: 1,
        column: 1, // "export" keyword
      });

      expect(result.sourceKind).toBe("unknown");
    });
  });
});
