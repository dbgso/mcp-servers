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
  // The ordering assertions below are the point of these tests. `?`-style
  // engines bind by textual position, so a placeholder allocated out of order
  // receives its neighbour's value -- and the resulting statement is either
  // rejected by the engine or, worse, silently answers the wrong question.
  it("binds placeholders in the order the dialect emits them (pg)", () => {
    const built = buildFindByJsonPath({
      dialect: pgFakeDialect,
      table: "users",
      field: "meta",
      path: "$.foo.bar",
      value: "x",
      columns: ["id", "meta"],
      limit: 5,
    });
    // Order: segments ($1), value ($2), limit ($3) -- left to right.
    expect(built.sql).toBe(
      'SELECT "id", "meta" FROM "users" WHERE "meta" #>> $1 = $2 LIMIT $3',
    );
    expect(built.values).toEqual([["foo", "bar"], "x", 5]);
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
    expect(built.values[0]).toEqual([]);
  });

  it("binds placeholders in the order the dialect emits them (mysql)", () => {
    const built = buildFindByJsonPath({
      dialect: mysqlFakeDialect,
      table: "users",
      field: "meta",
      path: "$.foo.bar",
      value: "x",
      columns: ["id", "meta"],
      limit: 5,
    });
    // Every `?` is anonymous, so this list *is* the mapping. Reverse the
    // first two and MySQL reads "$.foo.bar" as the value and "x" as the
    // JSON path, which it rejects with ER_INVALID_JSON_PATH.
    expect(built.sql).toBe(
      "SELECT `id`, `meta` FROM `users` WHERE JSON_EXTRACT(`meta`, ?) = ? LIMIT ?",
    );
    expect(built.values).toEqual(["$.foo.bar", "x", 5]);
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
