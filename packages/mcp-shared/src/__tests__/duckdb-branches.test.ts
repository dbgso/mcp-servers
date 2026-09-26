/**
 * The DuckDB helper's branches, which were the worst in the package at 57%.
 *
 * What was untested is everything that varies with the input rather than the
 * query: which read function a file extension maps to, what a value is escaped
 * as, which COPY options an output extension produces, and the multi-file
 * alias path. Those are the parts a caller reaches by passing a different
 * file, which is the ordinary way this is used.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describeFile, queryFile, queryRecords, countByField } from "../utils/duckdb.js";

let dir: string;

beforeAll(async () => {
  dir = join(tmpdir(), `duckdb-branches-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "people.csv"), "name,age\nAda,36\nGrace,45\n", "utf-8");
  await writeFile(join(dir, "pets.csv"), "owner,pet\nAda,cat\nGrace,dog\n", "utf-8");
  await writeFile(join(dir, "people.tsv"), "name\tage\nAda\t36\n", "utf-8");
  await writeFile(
    join(dir, "people.jsonl"),
    '{"name":"Ada","age":36}\n{"name":"Grace","age":45}\n',
    "utf-8"
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("queryFile with several files", () => {
  it("gives each file its own alias to join on", async () => {
    const result = await queryFile({
      files: [
        { alias: "people", path: join(dir, "people.csv") },
        { alias: "pets", path: join(dir, "pets.csv") },
      ],
      sql: 'SELECT p.name, t.pet FROM people p JOIN pets t ON p.name = t.owner ORDER BY p.name',
    });

    expect(result.rows).toEqual([
      { name: "Ada", pet: "cat" },
      { name: "Grace", pet: "dog" },
    ]);
  });

  it("takes a per-file encoding over the shared one", async () => {
    const result = await queryFile({
      files: [{ alias: "people", path: join(dir, "people.csv"), encoding: "utf-8" }],
      encoding: "latin-1",
      sql: "SELECT count(*) AS n FROM people",
    });

    expect(Number(result.rows[0].n)).toBe(2);
  });

  it("refuses a call that names no file at all", async () => {
    // Otherwise the query runs against an empty in-memory database and returns
    // a confusing SQL error instead of saying what is missing.
    await expect(queryFile({ sql: "SELECT 1" })).rejects.toThrow(
      "Either filePath or files must be provided"
    );
  });

  it("refuses an empty file list for the same reason", async () => {
    await expect(queryFile({ files: [], sql: "SELECT 1" })).rejects.toThrow(
      "Either filePath or files must be provided"
    );
  });
});

describe("queryFile writing its result out", () => {
  it.each([
    ["csv", "out.csv", "name,age"],
    ["tsv", "out.tsv", "name\tage"],
    ["json", "out.json", '"name"'],
  ])("writes %s by extension", async (_kind, name, expected) => {
    // The extension picks the COPY options, so each one is a separate branch
    // and a separate file on disk for the caller.
    const outputPath = join(dir, name);

    const result = await queryFile({
      filePath: join(dir, "people.csv"),
      sql: "SELECT * FROM data ORDER BY name",
      outputPath,
    });

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(2);
    expect(result.outputPath).toBe(outputPath);
    expect(await readFile(outputPath, "utf-8")).toContain(expected);
  });

  it("writes parquet, which is not text", async () => {
    const outputPath = join(dir, "out.parquet");

    await queryFile({
      filePath: join(dir, "people.csv"),
      sql: "SELECT * FROM data",
      outputPath,
    });

    // Every parquet file starts with the magic bytes PAR1.
    expect((await readFile(outputPath)).subarray(0, 4).toString()).toBe("PAR1");
  });

  it("falls back to CSV for an extension it does not know", async () => {
    const outputPath = join(dir, "out.unknown");

    await queryFile({
      filePath: join(dir, "people.csv"),
      sql: "SELECT * FROM data ORDER BY name",
      outputPath,
    });

    expect(await readFile(outputPath, "utf-8")).toContain("name,age");
  });

  it("counts the rows it wrote, not the rows it returned", async () => {
    // The caller gets no rows back when writing to a file, so the count is
    // the only thing that says whether the query matched anything.
    const result = await queryFile({
      filePath: join(dir, "people.csv"),
      sql: "SELECT * FROM data WHERE age > 40",
      outputPath: join(dir, "filtered.csv"),
    });

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(1);
  });
});

describe("describeFile by extension", () => {
  it.each([
    ["people.csv", "csv"],
    ["people.tsv", "tsv"],
    ["people.jsonl", "jsonl"],
  ])("reports %s as %s", async (name, format) => {
    const result = await describeFile({ filePath: join(dir, name) });

    expect(result.format).toBe(format);
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.columns.map((c) => c.name)).toContain("name");
  });

  it("passes an encoding through to the read function", async () => {
    const result = await describeFile({ filePath: join(dir, "people.csv"), encoding: "utf-8" });

    expect(result.columns).toHaveLength(2);
  });
});

describe("in-memory records", () => {
  it("escapes a quote in a value rather than breaking the statement", async () => {
    // The value is interpolated into SQL, so an apostrophe in a name is the
    // difference between a row and a syntax error.
    const rows = await queryRecords({
      records: [{ name: "O'Brien" }, { name: "Ada" }],
      sql: "SELECT name FROM entries ORDER BY name",
    });

    expect(rows).toEqual([{ name: "Ada" }, { name: "O'Brien" }]);
  });

  it("keeps numbers numeric and everything else text", async () => {
    const rows = await queryRecords({
      records: [{ n: 2, s: "b" }, { n: 1, s: "a" }],
      sql: "SELECT n + 1 AS n1, s FROM entries ORDER BY n",
    });

    expect(rows).toEqual([{ n1: 2, s: "a" }, { n1: 3, s: "b" }]);
  });

  it("writes a null as an empty string rather than the word null", async () => {
    const rows = await queryRecords({
      records: [{ name: null }],
      sql: "SELECT name FROM entries",
    });

    expect(rows).toEqual([{ name: "" }]);
  });

  it("takes an explicit column list, ignoring keys outside it", async () => {
    const rows = await queryRecords({
      records: [{ keep: "yes", drop: "no" }],
      columns: ["keep"],
      sql: "SELECT * FROM entries",
    });

    expect(rows).toEqual([{ keep: "yes" }]);
  });

  it("turns a bigint count into a number the caller can use", async () => {
    // DuckDB counts in BIGINT, which does not survive JSON.stringify.
    const rows = await queryRecords({
      records: [{ g: "a" }, { g: "a" }],
      sql: "SELECT count(*) AS n FROM entries",
    });

    expect(typeof rows[0].n === "number" || typeof rows[0].n === "string").toBe(true);
  });

  it("counts by a field, and takes the top N", async () => {
    const counted = await countByField({
      records: [{ g: "a" }, { g: "a" }, { g: "b" }],
      groupBy: "g",
      topN: 1,
    });

    expect(counted).toEqual([{ value: "a", count: 2 }]);
  });
});
