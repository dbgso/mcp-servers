import { describe, it, expect } from "vitest";
import { createStandardRespond } from "../helpers/default-respond.js";

// jsonResponse identity so we can assert the produced payload object directly.
const id = (data: unknown): unknown => data;

describe("createStandardRespond — gate-rejected response bundle", () => {
  const r = createStandardRespond({
    jsonResponse: id,
    labels: { containerNoun: "Table", fieldNoun: "column", availableListKey: "availableTables", allowedFieldsKey: "allowedColumns" },
  });

  it("notWhitelisted: message + custom available key", () => {
    expect(r.notWhitelisted({ container: "users", available: ["a", "b"] })).toEqual({
      error: "Table 'users' is not selectable.",
      availableTables: ["a", "b"],
    });
  });

  it("containerNotWhitelisted is the same shape as notWhitelisted", () => {
    expect(r.containerNotWhitelisted({ container: "u", available: ["a"] })).toEqual(
      r.notWhitelisted({ container: "u", available: ["a"] }),
    );
  });

  it("emptyWhitelist: uses fieldNoun plural", () => {
    expect(r.emptyWhitelist({ container: "audit" })).toEqual({
      error: "Table 'audit' has no selectable columns in the whitelist.",
    });
  });

  it("fieldNotSelectable: capitalizes fieldNoun + custom allowed key", () => {
    expect(r.fieldNotSelectable({ container: "users", field: "ssn", allowedFields: ["id"] })).toEqual({
      error: "Column 'ssn' is not selectable on 'users'.",
      allowedColumns: ["id"],
    });
  });

  it("guardFailed: surfaces the error message", () => {
    expect(r.guardFailed({ error: new Error("bad query") })).toEqual({ error: "bad query" });
  });

  it("containersMissing: joins missing + echoes requested", () => {
    expect(r.containersMissing({ containers: ["a", "b", "c"], missing: ["b", "c"] })).toEqual({
      error: "Tables not selectable: b, c",
      requested: ["a", "b", "c"],
      missing: ["b", "c"],
    });
  });
});

describe("createStandardRespond — defaults", () => {
  const r = createStandardRespond({ jsonResponse: id, labels: { containerNoun: "Bucket" } });

  it("availableListKey defaults to available<Noun>s", () => {
    expect(r.notWhitelisted({ container: "x", available: [] })).toEqual({
      error: "Bucket 'x' is not selectable.",
      availableBuckets: [],
    });
  });

  it("fieldNoun defaults to 'field' / allowedFieldsKey to 'allowedFields'", () => {
    expect(r.fieldNotSelectable({ container: "x", field: "f", allowedFields: ["g"] })).toEqual({
      error: "Field 'f' is not selectable on 'x'.",
      allowedFields: ["g"],
    });
    expect(r.emptyWhitelist({ container: "x" })).toEqual({
      error: "Bucket 'x' has no selectable fields in the whitelist.",
    });
  });

  it("emptyWhitelistSuffix is appended when provided", () => {
    const rs = createStandardRespond({
      jsonResponse: id,
      labels: { containerNoun: "Table", emptyWhitelistSuffix: "See describe_table." },
    });
    expect(rs.emptyWhitelist({ container: "t" })).toEqual({
      error: "Table 't' has no selectable fields in the whitelist. See describe_table.",
    });
  });
});
