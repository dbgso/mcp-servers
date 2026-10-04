import type { Report } from "../types.js";

/** A report with every field filled, optional ones included. */
export function fullReport(): Report {
  return {
    title: "パッケージに docs が入らない",
    conclusion: "docs/ は npm に配布されない",
    background: "利用者からルールが効いていないと言われた",
    impact: {
      ifLeft: "利用者はルールが効いていると思ったまま使い続ける",
      scope: [
        {
          who: "利用者",
          what: "describe の出力にルールの本文が載る",
          when: "次のリリースから",
          where: "describe",
          why: "docs/ は配布されない",
          how: "何もしなくてよい",
        },
      ],
    },
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
          { label: "describe", pros: "パッケージと一緒に届く", cons: "長くなると読まれにくい" },
          { label: "README", pros: "書き慣れた場所", cons: "読まれないことがある" },
        ],
        recommendation: { label: "describe", reason: "配布物に含まれる唯一の場所なので" },
      },
      { kind: "action", what: "PR をマージする" },
    ],
    decisions: [
      {
        what: "確認の方法",
        options: [
          { label: "npm pack の出力を見る", pros: "配布物そのものを見られる", cons: "pack を実行する手間がある" },
          { label: "package.json を読む", pros: "すぐ読める", cons: ".npmignore を見落とす" },
        ],
        chosen: { label: "npm pack の出力を見る", reason: "見落としが起きない" },
      },
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
    background: "b",
    impact: { ifLeft: "l", scope: [{ who: "a", what: "b", when: "c", where: "d", why: "e", how: "f" }] },
    claims: [{ statement: "s", evidence: [{ source: "cmd", output: "out" }] }],
    asks: [],
    decisions: [],
  };
}
