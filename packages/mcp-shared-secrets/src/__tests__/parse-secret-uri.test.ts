import { describe, it, expect } from "vitest";
import { parseSecretUri } from "../resolver.js";

const knownSchemes = new Set(["ssm", "sm", "env"]);

type ParseCase = {
  description: string;
  value: string;
  expected: { scheme: string; path: string } | null;
};

const matchCases: ParseCase[] = [
  {
    description: "ssm with leading-slash path",
    value: "ssm:/dbgen/url",
    expected: { scheme: "ssm", path: "/dbgen/url" },
  },
  {
    description: "sm with secret id",
    value: "sm:my-secret-id",
    expected: { scheme: "sm", path: "my-secret-id" },
  },
  {
    description: "env scheme referencing another key",
    value: "env:OTHER_KEY",
    expected: { scheme: "env", path: "OTHER_KEY" },
  },
  {
    description: "scheme with digits in name",
    value: "ssm:/path/with/colons:and:more",
    expected: { scheme: "ssm", path: "/path/with/colons:and:more" },
  },
];

const literalCases: ParseCase[] = [
  {
    description: "URL form (postgres://...) is literal",
    value: "postgres://user:pass@host/db",
    expected: null,
  },
  {
    description: "https:// URL is literal",
    value: "https://example.com/path",
    expected: null,
  },
  {
    description: "bare literal without colon",
    value: "bare-literal",
    expected: null,
  },
  {
    description: "unknown scheme is treated as literal",
    value: "unknown:/key",
    expected: null,
  },
  {
    description: "empty path → no match",
    value: "ssm:",
    expected: null,
  },
  {
    description: "missing scheme name (`:nopath`)",
    value: ":nopath",
    expected: null,
  },
  {
    description: "uppercase scheme is rejected (must be lowercase)",
    value: "SSM:/foo",
    expected: null,
  },
  {
    description: "scheme starting with digit is rejected",
    value: "1ssm:/foo",
    expected: null,
  },
  {
    description: "empty string",
    value: "",
    expected: null,
  },
];

describe("parseSecretUri", () => {
  it.each(matchCases)("matches: $description", ({ value, expected }) => {
    expect(parseSecretUri({ value, knownSchemes })).toEqual(expected);
  });

  it.each(literalCases)("literal: $description", ({ value, expected }) => {
    expect(parseSecretUri({ value, knownSchemes })).toEqual(expected);
  });

  it("returns null when knownSchemes is empty", () => {
    expect(parseSecretUri({ value: "ssm:/foo", knownSchemes: new Set() })).toBeNull();
  });
});
