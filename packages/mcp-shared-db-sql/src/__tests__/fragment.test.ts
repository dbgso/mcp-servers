import { describe, expect, it } from "vitest";
import { asQuotedIdent, ident, RawIdent, SqlFragment, sqlFragment } from "../fragment.js";

const col = asQuotedIdent('"meta"');

describe("sqlFragment", () => {
  it("binds every plain substitution, in textual order", () => {
    const f = sqlFragment`a ${1} b ${"two"} c`;
    expect(f.sql).toEqual(["a ", " b ", " c"]);
    expect(f.values).toEqual([1, "two"]);
  });

  it("splices an ident into the text instead of binding it", () => {
    // A bound identifier would be a string literal to the engine, not a
    // column -- the query would compare against the column's name.
    const f = sqlFragment`${ident(col)} #>> ${["x"]} = ${"v"}`;
    expect(f.sql).toEqual(['"meta" #>> ', " = ", ""]);
    expect(f.values).toEqual([["x"], "v"]);
  });

  it("keeps one more part than values when idents sit next to each other", () => {
    const f = sqlFragment`${ident(col)}${ident(col)} = ${1}`;
    expect(f.sql).toEqual(['"meta""meta" = ', ""]);
    expect(f.values).toEqual([1]);
  });

  it("is a single part with no values when nothing is substituted", () => {
    const f = sqlFragment`TRUE`;
    expect(f.sql).toEqual(["TRUE"]);
    expect(f.values).toEqual([]);
  });

  it("returns a SqlFragment, the only way to get one", () => {
    expect(sqlFragment`x`).toBeInstanceOf(SqlFragment);
    expect(ident(col)).toBeInstanceOf(RawIdent);
  });
});
