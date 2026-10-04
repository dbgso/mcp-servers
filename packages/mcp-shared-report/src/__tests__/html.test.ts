import { describe, expect, it } from "vitest";
import { renderHtml } from "../renderers/html/index.js";
import { escapeHtml } from "../renderers/html/escape.js";
import { fullReport, minimalReport } from "./fixtures.js";

describe("renderHtml", () => {
  it("lays the sections out in the spec's order", () => {
    const html = renderHtml({ report: fullReport() });
    const order = [
      'class="conclusion"',
      'class="background"',
      'class="asks"',
      'class="impact"',
      'class="corrections"',
      'class="decisions"',
      'class="claims"',
      'class="changes"',
      'class="remaining"',
      'class="asides"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says nothing is needed when there are no asks", () => {
    const html = renderHtml({ report: minimalReport() });
    expect(html).toContain('<section class="asks none"><h2>あなたに求めること</h2><p>対応不要</p></section>');
  });

  it("says no decision was made alone when there are none", () => {
    const html = renderHtml({ report: minimalReport() });
    expect(html).toContain('<section class="decisions none"><h2>自分で判断したこと</h2><p>なし</p></section>');
  });

  it("compares a decision's options in a table of pros and cons, the chosen row marked", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain(
      '<tr class="is-picked"><td><strong>npm pack の出力を見る</strong> <span class="recommended">採用</span></td><td>配布物そのものを見られる</td><td>pack を実行する手間がある</td></tr>',
    );
    expect(html).toContain("<tr><td><strong>package.json を読む</strong></td><td>すぐ読める</td><td>.npmignore を見落とす</td></tr>");
    expect(html).toContain('<p class="reason">採用した理由: 見落としが起きない</p>');
  });

  it("states the cost of leaving it and tabulates what doing it reaches", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain('<h3>対応しなかった場合</h3>\n<p class="if-left">利用者はルールが効いていると思ったまま使い続ける</p>');
    expect(html).toContain(
      "<thead><tr><th>誰が</th><th>何が</th><th>いつ</th><th>どこで</th><th>なぜ</th><th>どうすれば</th></tr></thead>",
    );
    expect(html).toContain(
      "<tr><td>利用者</td><td>describe の出力にルールの本文が載る</td><td>次のリリースから</td><td>describe</td><td>docs/ は配布されない</td><td>何もしなくてよい</td></tr>",
    );
  });

  it("leaves out optional sections the report does not fill", () => {
    const html = renderHtml({ report: minimalReport() });
    for (const marker of ['class="corrections"', 'class="changes"', 'class="remaining"', 'class="asides"']) {
      expect(html).not.toContain(marker);
    }
  });

  it("marks the recommended option and gives the reason", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain('<thead><tr><th>候補</th><th>長所</th><th>短所</th></tr></thead>');
    expect(html).toContain(
      '<tr class="is-picked"><td><strong>describe</strong> <span class="recommended">推奨</span></td><td>パッケージと一緒に届く</td><td>長くなると読まれにくい</td></tr>',
    );
    expect(html).toContain("<tr><td><strong>README</strong></td><td>書き慣れた場所</td><td>読まれないことがある</td></tr>");
    expect(html).toContain("推奨した理由: 配布物に含まれる唯一の場所なので");
    expect(html).toContain('<span class="kind">作業</span> PR をマージする');
  });

  it("keeps evidence output verbatim in a pre block", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain("<pre>dist/      176 files\nREADME.md\nLICENSE</pre>");
  });

  it("collapses asides", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain('<details class="asides"><summary>本題以外の発見（1）</summary>');
  });

  it("escapes every string, so a field cannot carry markup", () => {
    const report = { ...minimalReport(), title: "<script>alert(1)</script>", conclusion: "a & b" };
    const html = renderHtml({ report });
    expect(html).not.toContain("<script>");
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(html).toContain("a &amp; b");
  });

  it("loads nothing from outside the page", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).not.toMatch(/<script|<link|src=|https?:\/\//);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml({ text: `<a href="x">'&'</a>` })).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
