import { describe, it, expect } from "vitest";
import {
  publishableNames,
  stubManifest,
  classifyName,
  partitionByOwnership,
} from "../bootstrap-npm-names.mjs";

describe("publishableNames", () => {
  it("skips packages marked private", () => {
    const manifests = [
      { name: "kroki-mcp" },
      { name: "mcp-shared", private: true },
      { name: "ast-file-mcp", private: false },
    ];
    expect(publishableNames(manifests)).toEqual(["ast-file-mcp", "kroki-mcp"]);
  });

  it("treats a missing private field as publishable, matching npm", () => {
    expect(publishableNames([{ name: "a" }])).toEqual(["a"]);
  });

  // `private: "true"` is not `true`; npm would publish it. Anything looser here
  // would claim names the maintainer meant to keep off the registry.
  it("only honours a literal true", () => {
    expect(publishableNames([{ name: "a", private: "true" }])).toEqual(["a"]);
  });

  it("sorts, so the report is stable across runs", () => {
    expect(publishableNames([{ name: "z" }, { name: "a" }])).toEqual(["a", "z"]);
  });
});

describe("stubManifest", () => {
  const stub = stubManifest("kroki-mcp");

  it("claims the name at 0.0.0, below any real release", () => {
    expect(stub.name).toBe("kroki-mcp");
    expect(stub.version).toBe("0.0.0");
  });

  it.each(["main", "bin", "files", "dependencies", "scripts"])(
    "declares no %s -- installing the placeholder must do nothing",
    (field) => {
      expect(stub).not.toHaveProperty(field);
    },
  );

  it("publishes publicly, since the real packages are public", () => {
    expect(stub.publishConfig).toEqual({ access: "public" });
  });

  it("says in the description that it is not a release", () => {
    expect(stub.description).toMatch(/not a release/i);
  });
});

describe("classifyName", () => {
  it("calls a name the registry has never seen free", () => {
    expect(classifyName(null, "dbgso")).toBe("free");
  });

  it("calls a name we maintain ours", () => {
    expect(classifyName({ maintainers: [{ name: "dbgso" }] }, "dbgso")).toBe("ours");
  });

  // The case that matters: the name exists, so an existence check would call it
  // done -- but publishing to it can never succeed.
  it("calls a name maintained by someone else taken", () => {
    expect(classifyName({ maintainers: [{ name: "another-account" }] }, "dbgso")).toBe("taken");
  });

  it("counts us as an owner among co-maintainers", () => {
    const packument = { maintainers: [{ name: "someone" }, { name: "dbgso" }] };
    expect(classifyName(packument, "dbgso")).toBe("ours");
  });

  it("treats a packument with no maintainers as taken, not ours", () => {
    expect(classifyName({}, "dbgso")).toBe("taken");
  });
});

describe("partitionByOwnership", () => {
  it("groups names by classification", () => {
    const result = partitionByOwnership(["a", "b", "c"], { a: "ours", b: "free", c: "taken" });
    expect(result).toEqual({ free: ["b"], ours: ["a"], taken: ["c"] });
  });

  it("defaults an unclassified name to free", () => {
    expect(partitionByOwnership(["a"], {})).toEqual({ free: ["a"], ours: [], taken: [] });
  });

  it("preserves input order within each group", () => {
    const result = partitionByOwnership(["z", "a"], { z: "free", a: "free" });
    expect(result.free).toEqual(["z", "a"]);
  });
});
