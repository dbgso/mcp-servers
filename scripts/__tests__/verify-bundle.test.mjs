import { describe, it, expect } from "vitest";
import {
  extractBareImports,
  packageNameOf,
  findUndeclared,
  findUnusedDeclared,
} from "../verify-bundle.mjs";

/** An esbuild metafile with one output importing the given specifiers. */
function metafileWith(...paths) {
  return {
    outputs: {
      "dist/index.js": {
        entryPoint: "src/index.ts",
        imports: paths.map((path) => ({ path, kind: "import-statement", external: true })),
      },
    },
  };
}

describe("extractBareImports", () => {
  it.each([
    ["a plain package", ["zod"], ["zod"]],
    ["a dynamic import", ["lazy-pkg"], ["lazy-pkg"]],
    ["a scoped package", ["@scope/pkg"], ["@scope/pkg"]],
  ])("picks up %s", (_label, paths, expected) => {
    expect(extractBareImports(metafileWith(...paths))).toEqual(expected);
  });

  it.each([
    ["./local.js", "relative"],
    ["../up.js", "parent-relative"],
    ["/abs/path.js", "absolute"],
  ])("ignores %j (%s, never resolved from a registry)", (path) => {
    expect(extractBareImports(metafileWith(path))).toEqual([]);
  });

  it("deduplicates and sorts", () => {
    expect(extractBareImports(metafileWith("zod", "zod", "acorn"))).toEqual(["acorn", "zod"]);
  });

  it("keeps subpaths distinct from their package", () => {
    expect(extractBareImports(metafileWith("@scope/pkg/sub.js", "@scope/pkg"))).toEqual([
      "@scope/pkg",
      "@scope/pkg/sub.js",
    ]);
  });

  it("collects imports across every output, not just the entry", () => {
    const metafile = {
      outputs: {
        "dist/index.js": { entryPoint: "src/index.ts", imports: [{ path: "zod", external: true }] },
        "dist/chunk-A.js": { imports: [{ path: "acorn", external: true }] },
      },
    };
    expect(extractBareImports(metafile)).toEqual(["acorn", "zod"]);
  });

  it("ignores the bundle's own chunks, which ship with it", () => {
    const metafile = {
      outputs: {
        "dist/index.js": {
          entryPoint: "src/index.ts",
          imports: [
            { path: "zod", kind: "import-statement", external: true },
            { path: "dist/chunk-ABC123.js", kind: "import-statement", external: false },
            { path: "dist/lib-XYZ.js", kind: "import-statement" },
          ],
        },
      },
    };
    expect(extractBareImports(metafile)).toEqual(["zod"]);
  });

  it("tolerates an output with no imports", () => {
    expect(extractBareImports({ outputs: { "dist/index.js": {} } })).toEqual([]);
  });

  // The reason this reads a metafile rather than the emitted JavaScript: bundled
  // code embeds tool descriptions and JSON Schema text, and scanning that text
  // for import syntax reported those strings as dependencies.
  it("is unaffected by import-like text inside the bundle", () => {
    const metafile = metafileWith("zod");
    metafile.outputs["dist/index.js"].bytes = 1234;
    expect(extractBareImports(metafile)).toEqual(["zod"]);
  });
});

describe("packageNameOf", () => {
  it.each([
    ["zod", "zod"],
    ["zod/lib/index.js", "zod"],
    ["@scope/pkg", "@scope/pkg"],
    ["@scope/pkg/deep/sub.js", "@scope/pkg"],
    ["@modelcontextprotocol/sdk/server/stdio.js", "@modelcontextprotocol/sdk"],
  ])("%s -> %s", (specifier, expected) => {
    expect(packageNameOf(specifier)).toBe(expected);
  });
});

describe("findUndeclared", () => {
  it("accepts specifiers whose package is declared", () => {
    expect(findUndeclared(["zod", "zod/lib.js"], ["zod"])).toEqual([]);
  });

  it("flags a package that is not declared", () => {
    expect(findUndeclared(["zod", "sneaky"], ["zod"])).toEqual(["sneaky"]);
  });

  it.each(["fs", "node:fs", "path", "node:path"])("treats %s as a builtin, not a dependency", (builtin) => {
    expect(findUndeclared([builtin], [])).toEqual([]);
  });

  it("matches a subpath import against its declared package", () => {
    expect(findUndeclared(["@modelcontextprotocol/sdk/server/stdio.js"], ["@modelcontextprotocol/sdk"])).toEqual([]);
  });
});

describe("findUnusedDeclared", () => {
  it("flags a dependency the bundle never imports", () => {
    expect(findUnusedDeclared(["zod"], ["zod", "zod-to-json-schema"])).toEqual(["zod-to-json-schema"]);
  });

  it("counts a dependency reached only through a subpath as used", () => {
    expect(findUnusedDeclared(["@modelcontextprotocol/sdk/server/stdio.js"], ["@modelcontextprotocol/sdk"])).toEqual([]);
  });

  it("returns nothing when every declared dependency is imported", () => {
    expect(findUnusedDeclared(["zod", "acorn"], ["zod", "acorn"])).toEqual([]);
  });

  it("ignores imports that are not declared -- findUndeclared owns that direction", () => {
    expect(findUnusedDeclared(["zod", "undeclared-pkg"], ["zod"])).toEqual([]);
  });
});
