import { describe, expect, it } from "vitest";
import {
  buildFindByEq,
  buildFindByJsonPath,
  buildFindByPk,
  buildFindByRange,
  parseJsonPath,
} from "../builder.js";
import { mysqlFakeDialect, pgFakeDialect } from "./fixtures.js";

describe("parseJsonPath", () => {
  it.each([
    { input: "$.foo.bar", expected: ["foo", "bar"] },
    { input: "$.foo", expected: ["foo"] },
    { input: "$", expected: [] },
    { input: "$.", expected: [] },
    { input: "$.a.b.c.d", expected: ["a", "b", "c", "d"] },
    // Defensive: malformed `$.a..b` still produces a clean segment list.
    { input: "$.a..b", expected: ["a", "b"] },
  ])("splits '$input' into $expected", ({ input, expected }) => {
    const out = parseJsonPath(input);
    expect(out.raw).toBe(input);
    expect(out.segments).toEqual(expected);
  });
});

describe("buildFindByPk", () => {
  it.each([
    {
      label: "pg dialect",
      dialect: pgFakeDialect,
      expectedSql:
        'SELECT "id", "name" FROM "users" WHERE "id" = $1 LIMIT 1',
    },
    {
      label: "mysql dialect",
      dialect: mysqlFakeDialect,
      expectedSql:
        "SELECT `id`, `name` FROM `users` WHERE `id` = ? LIMIT 1",
    },
  ])("$label", ({ dialect, expectedSql }) => {
    const built = buildFindByPk({
      dialect,
      table: "users",
      pkColumn: "id",
      pk: 42,
      columns: ["id", "name"],
    });
    expect(built.sql).toBe(expectedSql);
    expect(built.values).toEqual([42]);
  });
});

describe("buildFindByEq", () => {
  it.each([
    {
      label: "pg dialect",
      dialect: pgFakeDialect,
      expectedSql:
        'SELECT "id", "fk" FROM "orders" WHERE "fk" = $1 LIMIT $2',
    },
    {
      label: "mysql dialect",
      dialect: mysqlFakeDialect,
      expectedSql:
        "SELECT `id`, `fk` FROM `orders` WHERE `fk` = ? LIMIT ?",
    },
  ])("$label", ({ dialect, expectedSql }) => {
    const built = buildFindByEq({
      dialect,
      table: "orders",
      field: "fk",
      value: "abc",
      columns: ["id", "fk"],
      limit: 10,
    });
    expect(built.sql).toBe(expectedSql);
    expect(built.values).toEqual(["abc", 10]);
  });
});

describe("buildFindByRange", () => {
  it.each([
    {
      label: "pg dialect",
      dialect: pgFakeDialect,
      expectedSql:
        'SELECT "id", "createdAt" FROM "events" WHERE "createdAt" BETWEEN $1 AND $2 LIMIT $3',
    },
    {
      label: "mysql dialect",
      dialect: mysqlFakeDialect,
      expectedSql:
        "SELECT `id`, `createdAt` FROM `events` WHERE `createdAt` BETWEEN ? AND ? LIMIT ?",
    },
  ])("$label", ({ dialect, expectedSql }) => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-02-01T00:00:00Z");
    const built = buildFindByRange({
      dialect,
      table: "events",
      field: "createdAt",
      from,
      to,
      columns: ["id", "createdAt"],
      limit: 50,
    });
    expect(built.sql).toBe(expectedSql);
    expect(built.values).toEqual([from, to, 50]);
  });
});

describe("buildFindByJsonPath", () => {
  it("pg dialect pushes segments placeholder after the value", () => {
    const built = buildFindByJsonPath({
      dialect: pgFakeDialect,
      table: "users",
      field: "meta",
      path: "$.foo.bar",
      value: "x",
      columns: ["id", "meta"],
      limit: 5,
    });
    // Order: value ($1), segments ($2), limit ($3).
    expect(built.sql).toBe(
      'SELECT "id", "meta" FROM "users" WHERE "meta" #>> $2 = $1 LIMIT $3',
    );
    expect(built.values).toEqual(["x", ["foo", "bar"], 5]);
  });

  it("pg dialect produces empty segments for root path", () => {
    const built = buildFindByJsonPath({
      dialect: pgFakeDialect,
      table: "users",
      field: "meta",
      path: "$",
      value: "y",
      columns: ["id"],
      limit: 1,
    });
    expect(built.values[1]).toEqual([]);
  });

  it("mysql dialect inlines the raw path literal", () => {
    const built = buildFindByJsonPath({
      dialect: mysqlFakeDialect,
      table: "users",
      field: "meta",
      path: "$.foo.bar",
      value: "x",
      columns: ["id", "meta"],
      limit: 5,
    });
    expect(built.sql).toBe(
      "SELECT `id`, `meta` FROM `users` WHERE JSON_EXTRACT(`meta`, '$.foo.bar') = ? LIMIT ?",
    );
    expect(built.values).toEqual(["x", 5]);
  });
});

describe("Dialect.quoteIdent escaping", () => {
  it.each([
    { dialect: pgFakeDialect, input: 'we"ird', expected: '"we""ird"' },
    { dialect: mysqlFakeDialect, input: "we`ird", expected: "`we``ird`" },
  ])("escapes embedded quotes ($expected)", ({ dialect, input, expected }) => {
    expect(dialect.quoteIdent(input)).toBe(expected);
  });
});
