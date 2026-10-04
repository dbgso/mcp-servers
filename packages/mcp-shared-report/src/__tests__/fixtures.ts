import type { Report } from "../types.js";

/** A report with every field filled, optional ones included. */
export function fullReport(): Report {
  return {
    title: "パッケージに docs が入らない",
    conclusion: "docs/ は npm に配布されない",
    claims: [
      {
        statement: "pack の出力に docs/ 由来のファイルがない",
        evidence: [{ source: "npm pack --dry-run", output: "dist/      176 files\nREADME.md\nLICENSE" }],
      },
    ],
    asks: [
      {
        kind: "decision",
        what: "ルールをどこに置くか決める",
        options: [
          { label: "describe", consequence: "パッケージと一緒に届く" },
          { label: "README", consequence: "読まれないことがある" },
        ],
        recommendation: { label: "describe", reason: "配布物に含まれる唯一の場所なので" },
      },
      { kind: "action", what: "PR をマージする" },
    ],
    corrections: [{ said: "lint が強制している", actually: "lint は強制していない", why: "設定を読まずに書いた" }],
    changes: [{ what: "files", before: "[\"dist\", \"docs\"]", after: "[\"dist\"]" }],
    remaining: [{ item: "CHANGELOG を書く", why: "リリース前に要る" }],
    asides: [{ note: "coding family も孤立している", cost: "lint の警告が残る" }],
  };
}

/** Only the required fields. */
export function minimalReport(): Report {
  return {
    title: "t",
    conclusion: "c",
    claims: [{ statement: "s", evidence: [{ source: "cmd", output: "out" }] }],
    asks: [],
  };
}
