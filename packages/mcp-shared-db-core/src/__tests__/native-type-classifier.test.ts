import { describe, it, expect } from "vitest";
import {
  classifyNativeType,
  looksLikeForeignKeyName,
  mapNativeType,
  nativeTypeBase,
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
    ["timestamp with time zone", "temporal"],
    ["year", "temporal"],
    // boolean
    ["boolean", "boolean"],
    ["bool", "boolean"],
    ["tinyint(1)", "boolean"],
    // Regression: codegen read this as boolean, the validator as numeric.
    ["tinyint(1) unsigned", "boolean"],
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
    ["int(10) unsigned", "numeric"],
    ["bit(8)", "numeric"],
    // text
    ["text", "text"],
    ["longtext", "text"],
    ["mediumtext", "text"],
    ["tinytext", "text"],
    ["json", "text"],
    ["jsonb", "text"],
    ["varchar(255)", "text"],
    ["char(3)", "text"],
    ["character varying(20)", "text"],
    ["uuid", "text"],
    // other / fallback
    ["decimal(10,2)", "other"],
    ["numeric(8,2)", "other"], // PostgreSQL's `numeric` (not int family)
    ["bytea", "other"],
    ["blob", "other"],
    ["inet", "other"],
    ["", "other"],
    [undefined, "other"],
  ])("classifies %s as %s", (input, expected) => {
    expect(classifyNativeType(input)).toBe(expected);
  });
});

describe("nativeTypeBase", () => {
  it.each<[string, string]>([
    ["INT(10) UNSIGNED ZEROFILL", "int"],
    ["bigint signed", "bigint"],
    ["enum('a)','b')", "enum"],
    ["timestamp(3) with time zone", "timestamp with time zone"],
    ["  character   varying(255) ", "character varying"],
    ["tinyint( 1 )", "tinyint(1)"],
    ["tinyint(4)", "tinyint"],
  ])("reduces %s to %s", (input, expected) => {
    expect(nativeTypeBase(input)).toBe(expected);
  });
});

describe("mapNativeType", () => {
  it("reads only the named engine's table", () => {
    // `bit` is a MySQL integer type; Postgres `bit` is a bit string.
    expect(mapNativeType({ nativeType: "bit(8)", engine: "mysql" })).toBe("number");
    expect(mapNativeType({ nativeType: "bit(8)", engine: "postgres" })).toBeUndefined();
    expect(mapNativeType({ nativeType: "bytea", engine: "mysql" })).toBeUndefined();
    expect(mapNativeType({ nativeType: "bytea", engine: "postgres" })).toBe("binary");
  });

  it("maps an enum to string and leaves unknown types to the caller", () => {
    expect(mapNativeType({ nativeType: "enum('a','b')", engine: "mysql" })).toBe("string");
    expect(mapNativeType({ nativeType: "inet", engine: "postgres" })).toBeUndefined();
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
