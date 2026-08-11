import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  countByField,
  queryRecords,
  queryFile,
  describeFile,
  sanitizeDuckDBError,
  getReadFunction,
} from "../utils/duckdb.js";

const testDir = join(tmpdir(), `duckdb-test-${Date.now()}`);
const csvPath = join(testDir, "test.csv");
const jsonPath = join(testDir, "test.json");

beforeAll(async () => {
  await mkdir(testDir, { recursive: true });
  await writeFile(csvPath, "name,age,city\nAlice,30,Tokyo\nBob,25,Osaka\nCarol,30,Tokyo\n");
  await writeFile(
    jsonPath,
    JSON.stringify([
      { name: "Alice", score: 90 },
      { name: "Bob", score: 80 },
      { name: "Carol", score: 95 },
    ]),
  );
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("getReadFunction", () => {
  it.each([
    { ext: ".csv", expected: "read_csv_auto", desc: "csv" },
    { ext: ".tsv", expected: "read_csv_auto", desc: "tsv" },
    { ext: ".json", expected: "read_json_auto", desc: "json" },
    { ext: ".jsonl", expected: "read_json_auto", desc: "jsonl" },
    { ext: ".parquet", expected: "read_parquet", desc: "parquet" },
  ])("returns $expected for $desc", ({ ext, expected }) => {
    expect(getReadFunction(`file${ext}`)).toBe(expected);
  });

  it("throws for unsupported extension", () => {
    expect(() => getReadFunction("file.xlsx")).toThrow("Unsupported file extension");
  });
});

describe("sanitizeDuckDBError", () => {
  it("redacts Original Line content", () => {
    const error = new Error("CSV Error\nOriginal Line:\n+81-090-1234-5678,John Doe\n\nInvalid");
    const result = sanitizeDuckDBError(error);
    expect(result).toContain("Original Line: [redacted]");
    expect(result).not.toContain("1234-5678");
  });

  it("handles non-Error input", () => {
    expect(sanitizeDuckDBError("simple string")).toBe("simple string");
  });
});

describe("countByField", () => {
  it("counts records grouped by a field", async () => {
    const records = [
      { city: "Tokyo", name: "A" },
      { city: "Osaka", name: "B" },
      { city: "Tokyo", name: "C" },
    ];
    const result = await countByField({ records, groupBy: "city" });
    expect(result).toEqual([
      { value: "Tokyo", count: 2 },
      { value: "Osaka", count: 1 },
    ]);
  });

  it("returns empty array for empty records", async () => {
    const result = await countByField({ records: [], groupBy: "city" });
    expect(result).toEqual([]);
  });

  it("respects topN limit", async () => {
    const records = [{ x: "a" }, { x: "a" }, { x: "a" }, { x: "b" }, { x: "b" }, { x: "c" }];
    const result = await countByField({ records, groupBy: "x", topN: 2 });
    expect(result.length).toBe(2);
    expect(result[0].value).toBe("a");
  });
});

describe("queryRecords", () => {
  it("runs SQL against in-memory records", async () => {
    const records = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const result = await queryRecords({
      records,
      sql: "SELECT name FROM entries WHERE age > 26",
    });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Alice");
  });

  it("returns empty for empty records", async () => {
    const result = await queryRecords({ records: [], sql: "SELECT * FROM entries" });
    expect(result).toEqual([]);
  });
});

describe("describeFile", () => {
  it("returns schema for CSV file", async () => {
    const result = await describeFile({ filePath: csvPath });
    expect(result.format).toBe("csv");
    expect(result.rowCount).toBe(3);
    expect(result.columns.length).toBe(3);
    expect(result.columns.map((c) => c.name)).toEqual(["name", "age", "city"]);
  });

  it("returns schema for JSON file", async () => {
    const result = await describeFile({ filePath: jsonPath });
    expect(result.format).toBe("json");
    expect(result.rowCount).toBe(3);
    expect(result.columns.map((c) => c.name)).toContain("name");
    expect(result.columns.map((c) => c.name)).toContain("score");
  });
});

describe("queryFile", () => {
  it("queries CSV file", async () => {
    const result = await queryFile({
      filePath: csvPath,
      sql: "SELECT name, age FROM data WHERE age = 30",
    });
    expect(result.rowCount).toBe(2);
    expect(result.rows.length).toBe(2);
  });

  it("respects limit", async () => {
    const result = await queryFile({
      filePath: csvPath,
      sql: "SELECT * FROM data",
      limit: 1,
    });
    expect(result.rows.length).toBe(1);
  });

  it("queries JSON file", async () => {
    const result = await queryFile({
      filePath: jsonPath,
      sql: "SELECT name, score FROM data ORDER BY score DESC",
      limit: 2,
    });
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].name).toBe("Carol");
  });

  it("writes output to file", async () => {
    const outputPath = join(testDir, "output.csv");
    const result = await queryFile({
      filePath: csvPath,
      sql: "SELECT * FROM data",
      outputPath,
    });
    expect(result.outputPath).toBe(outputPath);
    expect(result.rowCount).toBe(3);
    expect(result.rows.length).toBe(0);
  });
});
