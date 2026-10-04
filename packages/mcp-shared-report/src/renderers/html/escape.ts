/** Escape text for HTML element content and attribute values. */
export function escapeHtml(params: { text: string }): string {
  const { text } = params;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
