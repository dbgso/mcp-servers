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

  it("shows a decision with its grounds and what was turned down", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain("<strong>npm pack の出力を見る</strong>");
    expect(html).toContain("根拠: 配布物そのものを見られる");
    expect(html).toContain("<s>package.json を読む</s><span class=\"why\">退けた理由: .npmignore を見落とす</span>");
  });

  it("leaves out optional sections the report does not fill", () => {
    const html = renderHtml({ report: minimalReport() });
    for (const marker of ['class="corrections"', 'class="changes"', 'class="remaining"', 'class="asides"']) {
      expect(html).not.toContain(marker);
    }
  });

  it("marks the recommended option and gives the reason", () => {
    const html = renderHtml({ report: fullReport() });
    expect(html).toContain('<li class="is-recommended"><strong>describe</strong> <span class="recommended">推奨</span>');
    expect(html).toContain("<li><strong>README</strong><br>");
    expect(html).toContain("推奨の理由: 配布物に含まれる唯一の場所なので");
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
