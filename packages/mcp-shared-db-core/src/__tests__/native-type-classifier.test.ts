import { describe, it, expect } from "vitest";
import {
  classifyNativeType,
  looksLikeForeignKeyName,
  type NativeTypeClass,
} from "../native-type-classifier.js";

describe("classifyNativeType", () => {
  it.each<[string | undefined, NativeTypeClass]>([
    // temporal
    ["timestamp", "temporal"],
    ["timestamp(6)", "temporal"],
    ["timestamptz", "temporal"],
    ["datetime", "temporal"],
    ["datetime(3)", "temporal"],
    ["date", "temporal"],
    ["time", "temporal"],
    ["TIMESTAMP", "temporal"], // case insensitive
    // boolean
    ["boolean", "boolean"],
    ["bool", "boolean"],
    ["tinyint(1)", "boolean"],
    // enum
    ["enum('A','B')", "enum"],
    ["enum('Draft','Published','Archived')", "enum"],
    // numeric
    ["int", "numeric"],
    ["int4", "numeric"],
    ["int8", "numeric"],
    ["bigint", "numeric"],
    ["smallint", "numeric"],
    ["tinyint", "numeric"], // bare tinyint (NOT tinyint(1))
    ["mediumint", "numeric"],
    ["serial", "numeric"],
    // text
    ["text", "text"],
    ["longtext", "text"],
    ["mediumtext", "text"],
    ["tinytext", "text"],
    ["json", "text"],
    ["jsonb", "text"],
    ["varchar(255)", "text"],
    ["char(3)", "text"],
    // other / fallback
    ["decimal(10,2)", "other"],
    ["numeric(8,2)", "other"], // PostgreSQL's `numeric` (not int family)
    ["bytea", "other"],
    ["blob", "other"],
    ["uuid", "other"],
    ["inet", "other"],
    ["", "other"],
    [undefined, "other"],
  ])("classifies %s as %s", (input, expected) => {
    expect(classifyNativeType(input)).toBe(expected);
  });
});

describe("looksLikeForeignKeyName", () => {
  it.each<[string, boolean]>([
    ["id", true],
    ["user_id", true],
    ["created_by_user_id", true],
    ["parent_id", true],
    ["name", false],
    ["email", false],
    ["payment_amount", false],
    ["id_card", false],
    ["ide", false],
    ["", false],
  ])("returns %s for %s", (input, expected) => {
    expect(looksLikeForeignKeyName(input)).toBe(expected);
  });
});
