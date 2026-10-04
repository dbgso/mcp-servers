import { escapeHtml } from "./escape.js";

/**
 * Colours as tokens, redefined for dark mode. No script and no external
 * resource: the page has to open offline, from a file, years later.
 */
const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #59636e;
  --line: #d1d9e0;
  --panel: #f6f8fa;
  --accent: #0969da;
  --ask-bg: #fff8c5;
  --ask-line: #d4a72c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9198a1;
    --line: #3d444d;
    --panel: #151b23;
    --accent: #4493f8;
    --ask-bg: #2e2a1a;
    --ask-line: #9e7a1c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px 16px 64px;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.7 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
}
main { max-width: 860px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 8px; }
h2 { font-size: 1.15rem; margin: 32px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.conclusion { font-size: 1.15rem; font-weight: 600; margin: 0; }
.asks { background: var(--ask-bg); border: 1px solid var(--ask-line); border-radius: 8px; padding: 4px 16px 12px; margin-top: 24px; }
.asks h2 { border-bottom-color: var(--ask-line); margin-top: 12px; }
.asks.none { background: var(--panel); border-color: var(--line); }
.asks.none h2 { border-bottom-color: var(--line); }
.kind { display: inline-block; font-size: .8rem; padding: 0 8px; border-radius: 999px; border: 1px solid var(--ask-line); }
.comparison { display: table; margin: 8px 0 4px; }
.comparison th:first-child { width: 28%; }
.is-picked td { background: var(--panel); }
.is-picked td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
.recommended { font-size: .8rem; color: var(--accent); }
.reason, .why { color: var(--muted); }
.why { display: block; font-size: .9rem; }
.statement { font-weight: 600; margin-bottom: 4px; }
.background { margin: 12px 0 0; }
h3 { font-size: .95rem; margin: 12px 0 4px; }
.if-left { margin: 0; }
.impact table { display: table; }
.label { display: inline-block; font-size: .8rem; padding: 0 8px; margin-right: 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.decisions .what { font-weight: 600; margin: 0 0 4px; }
.decisions.none p { color: var(--muted); }
figure { margin: 0 0 12px; }
figcaption { font-size: .85rem; color: var(--muted); }
pre { margin: 4px 0 0; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; font-size: .85rem; line-height: 1.5; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
table { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border: 1px solid var(--line); }
th { background: var(--panel); }
s { color: var(--muted); }
details { margin-top: 32px; border-top: 1px solid var(--line); padding-top: 8px; }
summary { cursor: pointer; color: var(--muted); }
`;

/** The full page around the rendered sections. */
export function renderDocument(params: { title: string; body: string }): string {
  const { title, body } = params;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml({ text: title })}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
