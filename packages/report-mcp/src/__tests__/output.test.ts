import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportFileName, writeNewFile } from "../output.js";

const NOW = new Date("2026-10-04T08:45:07.123Z");

describe("reportFileName", () => {
  it.each([
    ["Docs are NOT shipped!", "2026-10-04T08-45-07-docs-are-not-shipped"],
    ["報告", "2026-10-04T08-45-07-報告"],
    ["report-mcp を実際の MCP クライアントから使った結果", "2026-10-04T08-45-07-report-mcp-を実際の-mcp-クライアントから使った結果"],
    ["ＡＢＣ／テスト：１", "2026-10-04T08-45-07-abc-テスト-1"],
    ["a/b\\c:d*e?f\"g<h>i|j", "2026-10-04T08-45-07-a-b-c-d-e-f-g-h-i-j"],
    ["🎉 !!", "2026-10-04T08-45-07-report"],
    ["𠮷".repeat(41), `2026-10-04T08-45-07-${"𠮷".repeat(40)}`],
    ["--a--", "2026-10-04T08-45-07-a"],
    ["a".repeat(39) + " b", `2026-10-04T08-45-07-${"a".repeat(39)}`],
  ])("names %j as %s", (title, expected) => {
    expect(reportFileName({ title, now: NOW })).toBe(expected);
  });
});

describe("writeNewFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "report-mcp-out-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the directory and numbers a taken name", async () => {
    const target = path.join(dir, "nested");
    const first = await writeNewFile({ dir: target, baseName: "r", extension: "html", content: "1" });
    const second = await writeNewFile({ dir: target, baseName: "r", extension: "html", content: "2" });
    expect([path.basename(first), path.basename(second)]).toEqual(["r.html", "r-2.html"]);
    expect(await readFile(first, "utf-8")).toBe("1");
  });

  it("passes on a failure other than a taken name", async () => {
    // A base name reaching into a directory that does not exist fails with ENOENT.
    await expect(
      writeNewFile({ dir, baseName: path.join("missing", "r"), extension: "html", content: "" }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
