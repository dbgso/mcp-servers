import type { Ask, DecisionOption, FiveW1H, Recommendation, Report } from "../../types.js";
import { escapeHtml } from "./escape.js";

/**
 * One block of the page.
 *
 * Each block decides for itself whether it has anything to show, so the page
 * is the blocks in order and nothing else -- no field-by-field branching in
 * the document template.
 */
export interface Section {
  /** The block's markup, or an empty string when the report has nothing for it. */
  render(report: Report): string;
}

const e = (text: string): string => escapeHtml({ text });

class HeaderSection implements Section {
  render(report: Report): string {
    return `<header>
<h1>${e(report.title)}</h1>
<p class="conclusion">${e(report.conclusion)}</p>
<p class="background"><span class="label">背景</span>${e(report.background)}</p>
</header>`;
  }
}

/**
 * Options as a table, one row each with what speaks for and against it, the
 * picked row marked and the reason it was picked right under the table (R9).
 */
function renderComparison(params: {
  options: DecisionOption[];
  picked: Recommendation;
  mark: string;
}): string {
  const { options, picked, mark } = params;
  const rows = options
    .map((option) => {
      const isPicked = option.label === picked.label;
      const badge = isPicked ? ` <span class="recommended">${mark}</span>` : "";
      return `<tr${isPicked ? ' class="is-picked"' : ""}><td><strong>${e(option.label)}</strong>${badge}</td><td>${e(option.pros)}</td><td>${e(option.cons)}</td></tr>`;
    })
    .join("\n");
  return `<table class="comparison">
<thead><tr><th>候補</th><th>長所</th><th>短所</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="reason">${mark}した理由: ${e(picked.reason)}</p>`;
}

/** The six parts in their fixed order, as table columns. */
const FIVE_W1H_KEYS: readonly (keyof FiveW1H)[] = ["who", "what", "when", "where", "why", "how"];

/** One 5W1H row per entry, under headers that say what each part means here (R11, R12). */
function renderFiveW1H(params: { rows: FiveW1H[]; headers: readonly string[] }): string {
  const { rows, headers } = params;
  const body = rows
    .map((row) => `<tr>${FIVE_W1H_KEYS.map((key) => `<td>${e(row[key])}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table class="five-w1h">
<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

/** Headers for a piece of work, the reader's or the reporter's. */
const WORK_HEADERS = ["誰が", "何を", "いつまでに", "どこで", "なぜ", "どうやって"] as const;

function renderAsk(params: { ask: Ask }): string {
  const { ask } = params;
  if (ask.kind === "action") {
    return `<li class="ask"><span class="kind">作業</span>
${renderFiveW1H({ rows: [ask], headers: WORK_HEADERS })}
</li>`;
  }
  return `<li class="ask"><span class="kind">判断</span> ${e(ask.what)}
${renderComparison({ options: ask.options, picked: ask.recommendation, mark: "推奨" })}
</li>`;
}

class AsksSection implements Section {
  render(report: Report): string {
    if (report.asks.length === 0) {
      return `<section class="asks none"><h2>あなたに求めること</h2><p>対応不要</p></section>`;
    }
    const items = report.asks.map((ask) => renderAsk({ ask })).join("\n");
    return `<section class="asks"><h2>あなたに求めること</h2>
<ol>
${items}
</ol>
</section>`;
  }
}

/** The cost of leaving the work undone, then what doing it reaches, one 5W1H row each (R10, R11). */
class ImpactSection implements Section {
  render(report: Report): string {
    const { ifLeft, scope } = report.impact;
    return `<section class="impact"><h2>影響</h2>
<h3>対応しなかった場合</h3>
<p class="if-left">${e(ifLeft)}</p>
<h3>対応した場合の影響範囲</h3>
${renderFiveW1H({ rows: scope, headers: ["誰が", "何が", "いつ", "どこで", "なぜ", "どうすれば"] })}
</section>`;
  }
}

class CorrectionsSection implements Section {
  render(report: Report): string {
    const corrections = report.corrections ?? [];
    if (corrections.length === 0) return "";
    const items = corrections
      .map(
        (c) => `<li><p><s>${e(c.said)}</s></p>
<p>実際: ${e(c.actually)}</p>
<p class="why">誤った理由: ${e(c.why)}</p></li>`,
      )
      .join("\n");
    return `<section class="corrections"><h2>訂正</h2>
<ul>
${items}
</ul>
</section>`;
  }
}

/** What the reporter chose and every option they weighed, so the reader can check the choice (R8). */
class DecisionsSection implements Section {
  render(report: Report): string {
    if (report.decisions.length === 0) {
      return `<section class="decisions none"><h2>自分で判断したこと</h2><p>なし</p></section>`;
    }
    const items = report.decisions
      .map(
        (d) => `<li><p class="what">${e(d.what)}</p>
${renderComparison({ options: d.options, picked: d.chosen, mark: "採用" })}
</li>`,
      )
      .join("\n");
    return `<section class="decisions"><h2>自分で判断したこと</h2>
<ol>
${items}
</ol>
</section>`;
  }
}

class ClaimsSection implements Section {
  render(report: Report): string {
    const items = report.claims
      .map((claim) => {
        const evidence = claim.evidence
          .map((ev) => `<figure><figcaption><code>${e(ev.source)}</code></figcaption><pre>${e(ev.output)}</pre></figure>`)
          .join("\n");
        return `<li><p class="statement">${e(claim.statement)}</p>
${evidence}</li>`;
      })
      .join("\n");
    return `<section class="claims"><h2>根拠</h2>
<ol>
${items}
</ol>
</section>`;
  }
}

class ChangesSection implements Section {
  render(report: Report): string {
    const changes = report.changes ?? [];
    if (changes.length === 0) return "";
    const rows = changes
      .map((c) => `<tr><td>${e(c.what)}</td><td>${e(c.where)}</td><td>${e(c.before)}</td><td>${e(c.after)}</td></tr>`)
      .join("\n");
    return `<section class="changes"><h2>変更</h2>
<table>
<thead><tr><th>対象</th><th>どこで</th><th>前</th><th>後</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
  }
}

/** Work left on the reporter's side, one 5W1H row each (R12). */
class RemainingSection implements Section {
  render(report: Report): string {
    const remaining = report.remaining ?? [];
    if (remaining.length === 0) return "";
    return `<section class="remaining"><h2>残作業</h2>
${renderFiveW1H({ rows: remaining, headers: WORK_HEADERS })}
</section>`;
  }
}

/** Collapsed, so it is there for whoever wants it and out of the way of everyone else (R5). */
class AsidesSection implements Section {
  render(report: Report): string {
    const asides = report.asides ?? [];
    if (asides.length === 0) return "";
    const items = asides
      .map(
        (a) =>
          `<li>${e(a.note)}<span class="why">場所: ${e(a.where)}</span><span class="why">放置した場合: ${e(a.cost)}</span></li>`,
      )
      .join("\n");
    return `<details class="asides"><summary>本題以外の発見（${asides.length}）</summary>
<ul>
${items}
</ul>
</details>`;
  }
}

/** The page order from the spec. A caller cannot change it. */
export const SECTIONS: readonly Section[] = [
  new HeaderSection(),
  new AsksSection(),
  new ImpactSection(),
  new CorrectionsSection(),
  new DecisionsSection(),
  new ClaimsSection(),
  new ChangesSection(),
  new RemainingSection(),
  new AsidesSection(),
];
