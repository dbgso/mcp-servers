import type { Report } from "../../types.js";
import { renderDocument } from "./document.js";
import { SECTIONS } from "./sections.js";

/**
 * A report as one self-contained HTML page.
 *
 * Every string from the report is escaped, so a caller cannot put markup on
 * the page: it fills fields, and the layout is this function's.
 */
export function renderHtml(params: { report: Report }): string {
  const { report } = params;
  const body = SECTIONS.map((section) => section.render(report))
    .filter((html) => html !== "")
    .join("\n");
  return renderDocument({ title: report.title, body });
}
