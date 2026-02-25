import { describe, it, expect, beforeAll } from "vitest";
import { TypeScriptHandler } from "../handlers/typescript.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures/type-definition");

describe("goToTypeDefinition", () => {
  let handler: TypeScriptHandler;

  beforeAll(() => {
    handler = new TypeScriptHandler();

    // Create test fixtures
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // Type definitions
    writeFileSync(
      join(FIXTURES_DIR, "types.ts"),
      `export interface User {
  id: number;
  name: string;
}

export type Status = "active" | "inactive";

export enum Color {
  Red,
  Green,
  Blue,
}

export class Service {
  run(): void {}
}
`
    );

    // Usage file
    writeFileSync(
      join(FIXTURES_DIR, "usage.ts"),
      `import { User, Status, Color, Service } from "./types.js";

const user: User = { id: 1, name: "Alice" };
const status: Status = "active";
const color: Color = Color.Red;
const service: Service = new Service();

function processUser(u: User): Status {
  return "active";
}
`
    );

    // tsconfig
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

  describe("interface type definition", () => {
    it("should navigate from variable to interface definition", async () => {
      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "usage.ts"),
        line: 3,
        column: 7, // "user" variable
      });

      expect(result.identifier).toBe("user");
      expect(result.typeText).toBe("User");
      expect(result.typeDefinitions.length).toBe(1);
      expect(result.typeDefinitions[0].name).toBe("User");
      expect(result.typeDefinitions[0].kind).toBe("interface");
    });

    it("should navigate from type annotation to interface definition", async () => {
      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "usage.ts"),
        line: 8,
        column: 25, // "User" in parameter type annotation "u: User"
      });

      expect(result.identifier).toBe("User");
      expect(result.typeDefinitions.length).toBe(1);
      expect(result.typeDefinitions[0].name).toBe("User");
      expect(result.typeDefinitions[0].kind).toBe("interface");
    });
  });

  describe("type alias definition", () => {
    it("should navigate from variable to type alias", async () => {
      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "usage.ts"),
        line: 4,
        column: 7, // "status" variable
      });

      expect(result.typeText).toBe("Status");
      expect(result.typeDefinitions.length).toBe(1);
      expect(result.typeDefinitions[0].name).toBe("Status");
      expect(result.typeDefinitions[0].kind).toBe("type");
    });
  });

  describe("enum definition", () => {
    it("should navigate from variable to enum definition", async () => {
      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "usage.ts"),
        line: 5,
        column: 7, // "color" variable
      });

      expect(result.typeText).toBe("Color");
      expect(result.typeDefinitions.length).toBe(1);
      expect(result.typeDefinitions[0].name).toBe("Color");
      expect(result.typeDefinitions[0].kind).toBe("enum");
    });
  });

  describe("class definition", () => {
    it("should navigate from variable to class definition", async () => {
      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "usage.ts"),
        line: 6,
        column: 7, // "service" variable
      });

      expect(result.typeText).toBe("Service");
      expect(result.typeDefinitions.length).toBe(1);
      expect(result.typeDefinitions[0].name).toBe("Service");
      expect(result.typeDefinitions[0].kind).toBe("class");
    });
  });

  describe("primitive types", () => {
    it("should return empty definitions for primitive types", async () => {
      writeFileSync(
        join(FIXTURES_DIR, "primitives.ts"),
        `const num: number = 42;`
      );

      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "primitives.ts"),
        line: 1,
        column: 7, // "num"
      });

      // Primitive types don't have navigable definitions (in node_modules)
      expect(result.typeText).toBe("number");
      expect(result.typeDefinitions).toEqual([]);
    });
  });

  describe("no symbol at position", () => {
    it("should return empty result for whitespace", async () => {
      const result = await handler.goToTypeDefinition({
        filePath: join(FIXTURES_DIR, "usage.ts"),
        line: 2,
        column: 1, // empty line or start
      });

      expect(result.typeDefinitions).toEqual([]);
    });
  });
});
