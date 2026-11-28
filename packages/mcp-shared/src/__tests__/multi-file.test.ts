/**
 * Processing several files in one call, and what the caller gets back.
 *
 * At 0% coverage. The shape of the response changes with the number of files,
 * which is the kind of thing a caller writes code against, so it is worth
 * pinning: one file returns the result on its own, several return an array.
 */

import { describe, expect, it } from "vitest";

import { formatMultiFileResponse, processMultipleFiles } from "../utils/multi-file.js";

const parsed = (response: { content: { text?: string }[] }) =>
  JSON.parse(response.content[0].text ?? "null");

describe("processMultipleFiles", () => {
  it("runs the processor over every path", async () => {
    const results = await processMultipleFiles({
      filePaths: ["a.ts", "b.ts"],
      processor: async (filePath) => ({ filePath, result: filePath.length }),
    });

    expect(results).toEqual([
      { filePath: "a.ts", result: 4 },
      { filePath: "b.ts", result: 4 },
    ]);
  });

  it("keeps the order of the paths, not the order they finished in", async () => {
    // `Promise.all` guarantees this, and a caller lining results up against
    // its own list depends on it.
    const results = await processMultipleFiles({
      filePaths: ["slow", "fast"],
      processor: async (filePath) => {
        await new Promise((r) => setTimeout(r, filePath === "slow" ? 20 : 1));
        return { filePath, result: filePath };
      },
    });

    expect(results.map((r) => r.filePath)).toEqual(["slow", "fast"]);
  });

  it("runs them at the same time rather than one after another", async () => {
    const started: string[] = [];
    await processMultipleFiles({
      filePaths: ["a", "b", "c"],
      processor: async (filePath) => {
        started.push(filePath);
        await new Promise((r) => setTimeout(r, 10));
        return { filePath };
      },
    });

    // All three had begun before any had finished.
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for no paths", async () => {
    expect(
      await processMultipleFiles({ filePaths: [], processor: async (filePath) => ({ filePath }) })
    ).toEqual([]);
  });

  it("lets a rejection through, rather than turning it into a per-file error", async () => {
    // The processor is expected to report its own failures in `error`. One
    // that throws is a bug in the caller, and hiding it here would bury it.
    await expect(
      processMultipleFiles({
        filePaths: ["a"],
        processor: async () => {
          throw new Error("processor bug");
        },
      })
    ).rejects.toThrow("processor bug");
  });
});

describe("formatMultiFileResponse", () => {
  it("returns a single file's result on its own", async () => {
    const response = formatMultiFileResponse([{ filePath: "a.ts", result: { lines: 3 } }]);

    expect(response.isError).toBeFalsy();
    expect(parsed(response)).toEqual({ lines: 3 });
  });

  it("reports a single file's error as an error response", async () => {
    const response = formatMultiFileResponse([{ filePath: "a.ts", error: "ENOENT" }]);

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe("Failed to read file: ENOENT");
  });

  it("returns an array once there is more than one file", async () => {
    const response = formatMultiFileResponse([
      { filePath: "a.ts", result: { lines: 1 } },
      { filePath: "b.ts", result: { lines: 2 } },
    ]);

    expect(parsed(response)).toEqual([{ lines: 1 }, { lines: 2 }]);
  });

  it("keeps the failures in place among the successes", async () => {
    // A batch where one file is missing is not a failed batch: the caller
    // still wants the others, and needs to know which one broke.
    const response = formatMultiFileResponse([
      { filePath: "a.ts", result: { lines: 1 } },
      { filePath: "b.ts", error: "ENOENT" },
    ]);

    expect(response.isError).toBeFalsy();
    expect(parsed(response)).toEqual([{ lines: 1 }, { filePath: "b.ts", error: "ENOENT" }]);
  });

  it("returns an empty array for no files", async () => {
    expect(parsed(formatMultiFileResponse([]))).toEqual([]);
  });
});
