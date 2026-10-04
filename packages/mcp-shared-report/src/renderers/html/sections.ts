import type { Ask, Report } from "../../types.js";
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

/** A decision lists its options with what each one leads to, and marks the recommended one. */
function renderAsk(params: { ask: Ask }): string {
  const { ask } = params;
  if (ask.kind === "action") {
    return `<li class="ask"><span class="kind">作業</span> ${e(ask.what)}</li>`;
  }
  const options = ask.options
    .map((option) => {
      const recommended = option.label === ask.recommendation.label;
      const mark = recommended ? ` <span class="recommended">推奨</span>` : "";
      return `<li${recommended ? ' class="is-recommended"' : ""}><strong>${e(option.label)}</strong>${mark}<br>${e(option.consequence)}</li>`;
    })
    .join("\n");
  return `<li class="ask"><span class="kind">判断</span> ${e(ask.what)}
<ul class="options">
${options}
</ul>
<p class="reason">推奨の理由: ${e(ask.recommendation.reason)}</p>
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

/** What the reporter chose, on what grounds, and what they turned down, so the reader can check it (R8). */
class DecisionsSection implements Section {
  render(report: Report): string {
    if (report.decisions.length === 0) {
      return `<section class="decisions none"><h2>自分で判断したこと</h2><p>なし</p></section>`;
    }
    const items = report.decisions
      .map((d) => {
        const rejected = d.rejected
          .map((r) => `<li><s>${e(r.option)}</s><span class="why">退けた理由: ${e(r.why)}</span></li>`)
          .join("\n");
        return `<li><p class="what">${e(d.what)}</p>
<p class="chosen"><strong>${e(d.chosen)}</strong></p>
<p class="grounds">根拠: ${e(d.why)}</p>
<ul class="rejected">
${rejected}
</ul></li>`;
      })
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
      .map((c) => `<tr><td>${e(c.what)}</td><td>${e(c.before)}</td><td>${e(c.after)}</td></tr>`)
      .join("\n");
    return `<section class="changes"><h2>変更</h2>
<table>
<thead><tr><th>対象</th><th>前</th><th>後</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
  }
}

class RemainingSection implements Section {
  render(report: Report): string {
    const remaining = report.remaining ?? [];
    if (remaining.length === 0) return "";
    const items = remaining.map((r) => `<li>${e(r.item)}<span class="why">${e(r.why)}</span></li>`).join("\n");
    return `<section class="remaining"><h2>残作業</h2>
<ul>
${items}
</ul>
</section>`;
  }
}

/** Collapsed, so it is there for whoever wants it and out of the way of everyone else (R5). */
class AsidesSection implements Section {
  render(report: Report): string {
    const asides = report.asides ?? [];
    if (asides.length === 0) return "";
    const items = asides
      .map((a) => `<li>${e(a.note)}<span class="why">放置した場合: ${e(a.cost)}</span></li>`)
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
  new CorrectionsSection(),
  new DecisionsSection(),
  new ClaimsSection(),
  new ChangesSection(),
  new RemainingSection(),
  new AsidesSection(),
];
