import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { DuckdbDescribeHandler } from "../tools/handlers/describe.js";
import { DuckdbQueryHandler } from "../tools/handlers/query.js";
import { DuckdbCountHandler } from "../tools/handlers/count.js";
import { getToolRegistry } from "../tools/registry.js";

const testDir = join(tmpdir(), `duckdb-mcp-test-${Date.now()}`);
const csvPath = join(testDir, "users.csv");
const jsonPath = join(testDir, "scores.json");

beforeAll(async () => {
  await mkdir(testDir, { recursive: true });
  await writeFile(csvPath, "name,age,city\nAlice,30,Tokyo\nBob,25,Osaka\nCarol,30,Tokyo\nDave,35,Nagoya\n");
  await writeFile(
    jsonPath,
    JSON.stringify([
      { name: "Alice", score: 90, subject: "math" },
      { name: "Bob", score: 80, subject: "math" },
      { name: "Carol", score: 95, subject: "science" },
      { name: "Dave", score: 70, subject: "science" },
    ]),
  );
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function parseResponse(result: { content: { type: string; text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("ToolRegistry", () => {
  it("registers all 3 tools", () => {
    const registry = getToolRegistry();
    const tools = registry.getAllTools();
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("duckdb_describe");
    expect(names).toContain("duckdb_query");
    expect(names).toContain("duckdb_count");
  });
});

describe("DuckdbDescribeHandler", () => {
  const handler = new DuckdbDescribeHandler();

  it("describes CSV file schema", async () => {
    const result = await handler.execute({ file_path: csvPath });
    const data = parseResponse(result) as { columns: { name: string }[]; rowCount: number; format: string };
    expect(data.format).toBe("csv");
    expect(data.rowCount).toBe(4);
    expect(data.columns.map((c) => c.name)).toEqual(["name", "age", "city"]);
  });

  it("describes JSON file schema", async () => {
    const result = await handler.execute({ file_path: jsonPath });
    const data = parseResponse(result) as { columns: { name: string }[]; rowCount: number; format: string };
    expect(data.format).toBe("json");
    expect(data.rowCount).toBe(4);
    expect(data.columns.map((c) => c.name)).toContain("name");
    expect(data.columns.map((c) => c.name)).toContain("score");
  });

  it("returns error for non-existent file", async () => {
    const result = await handler.execute({ file_path: "/nonexistent/file.csv" });
    expect(result.isError).toBe(true);
  });
});

describe("DuckdbQueryHandler", () => {
  const handler = new DuckdbQueryHandler();

  it("queries CSV file", async () => {
    const result = await handler.execute({
      file_path: csvPath,
      sql: "SELECT name, age FROM data WHERE age >= 30 ORDER BY name",
    });
    const data = parseResponse(result) as { rows: { name: string; age: number }[]; row_count: number };
    expect(data.row_count).toBe(3);
    expect(data.rows[0].name).toBe("Alice");
  });

  it("queries JSON file", async () => {
    const result = await handler.execute({
      file_path: jsonPath,
      sql: "SELECT name, score FROM data WHERE score > 85 ORDER BY score DESC",
    });
    const data = parseResponse(result) as { rows: { name: string; score: number }[]; row_count: number };
    expect(data.row_count).toBe(2);
    expect(data.rows[0].name).toBe("Carol");
  });

  it("respects limit", async () => {
    const result = await handler.execute({
      file_path: csvPath,
      sql: "SELECT * FROM data",
      limit: 2,
    });
    const data = parseResponse(result) as { rows: unknown[]; row_count: number };
    expect(data.row_count).toBe(2);
  });

  it("writes output to file", async () => {
    const outputPath = join(testDir, "output.csv");
    const result = await handler.execute({
      file_path: csvPath,
      sql: "SELECT * FROM data",
      output_path: outputPath,
    });
    const data = parseResponse(result) as { output_path: string; row_count: number };
    expect(data.output_path).toBe(outputPath);
    expect(data.row_count).toBe(4);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("returns error without data source", async () => {
    const result = await handler.execute({
      sql: "SELECT 1",
    });
    expect(result.isError).toBe(true);
  });

  it("supports multi-file queries", async () => {
    const result = await handler.execute({
      files: [
        { path: csvPath, alias: "users" },
        { path: jsonPath, alias: "scores" },
      ],
      sql: "SELECT u.name, u.city, s.score FROM users u JOIN scores s ON u.name = s.name ORDER BY s.score DESC",
    });
    const data = parseResponse(result) as { rows: { name: string; city: string; score: number }[]; row_count: number };
    expect(data.row_count).toBe(4);
    expect(data.rows[0].name).toBe("Carol");
    expect(data.rows[0].city).toBe("Tokyo");
  });
});

describe("DuckdbCountHandler", () => {
  const handler = new DuckdbCountHandler();

  it("counts by city", async () => {
    const result = await handler.execute({
      file_path: csvPath,
      group_by: "city",
    });
    const data = parseResponse(result) as { groups: { value: string; count: number }[] };
    expect(data.groups[0].value).toBe("Tokyo");
    expect(Number(data.groups[0].count)).toBe(2);
  });

  it("counts by subject in JSON", async () => {
    const result = await handler.execute({
      file_path: jsonPath,
      group_by: "subject",
    });
    const data = parseResponse(result) as { groups: { value: string; count: number }[] };
    expect(data.groups).toHaveLength(2);
  });

  it("respects top_n", async () => {
    const result = await handler.execute({
      file_path: csvPath,
      group_by: "city",
      top_n: 1,
    });
    const data = parseResponse(result) as { groups: { value: string; count: number }[] };
    expect(data.groups).toHaveLength(1);
  });
});
