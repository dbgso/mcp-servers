import { describe, expect, it } from "vitest";

import { escapeScriptJson, escapeXml } from "../../../renderers/html/escape.js";

describe("escapeXml", () => {
  type Case = { name: string; text: string; expected: string };
  const cases: Case[] = [
    { name: "ampersand first", text: "a & b", expected: "a &amp; b" },
    { name: "angle brackets", text: "<tag>", expected: "&lt;tag&gt;" },
    { name: "quotes", text: `"x" 'y'`, expected: "&quot;x&quot; &apos;y&apos;" },
    { name: "plain text is untouched", text: "plain", expected: "plain" },
  ];

  it.each(cases)("$name", ({ text, expected }) => {
    expect(escapeXml({ text })).toBe(expected);
  });
});

describe("escapeScriptJson", () => {
  it("neutralises a closing script tag", () => {
    const raw = { html: "</script><script>alert(1)</script>" };
    const encoded = escapeScriptJson({ value: raw });
    expect(encoded).not.toContain("</script>");
    expect(JSON.parse(encoded)).toEqual(raw);
  });

  it("escapes line and paragraph separators", () => {
    const raw = "a b c";
    const encoded = escapeScriptJson({ value: raw });
    expect(encoded).not.toContain(" ");
    expect(encoded).not.toContain(" ");
    expect(JSON.parse(encoded)).toBe(raw);
  });

  it("round-trips ordinary values", () => {
    const raw = { nodes: [{ id: "a", label: "日本語" }] };
    expect(JSON.parse(escapeScriptJson({ value: raw }))).toEqual(raw);
  });
});
