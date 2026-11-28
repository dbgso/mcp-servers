import { describe, it, expect } from "vitest";
import { findPeerProblems } from "../check-peer-floors.mjs";

const catalog = { pg: "8.23.1", mysql2: "3.24.6" };
const one = (peers) => findPeerProblems({ catalog, packages: [{ name: "p", peers }] });

describe("findPeerProblems", () => {
  it.each([
    ["a floor equal to the catalog", { pg: ">=8.23.1" }],
    ["a floor below the catalog (a bump does not force it up)", { pg: ">=8.11.0", mysql2: ">=3.0.0" }],
    ["a package with no driver peers", {}],
  ])("accepts %s", (_label, peers) => {
    expect(one(peers)).toEqual([]);
  });

  it.each([
    ["a floor above the catalog", { pg: ">=9.0.0" }, "above the catalog"],
    ["an exact pin, which a catalog bump leaves behind", { pg: "8.11.0" }, 'expected ">=x.y.z"'],
    ["a caret range", { mysql2: "^3.0.0" }, 'expected ">=x.y.z"'],
  ])("rejects %s", (_label, peers, message) => {
    const problems = one(peers);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(message);
  });

  it("says so when the catalog has no version of the driver", () => {
    const problems = findPeerProblems({ catalog: {}, packages: [{ name: "p", peers: { pg: ">=8.0.0" } }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("the catalog has no plain x.y.z version of pg");
  });
});
