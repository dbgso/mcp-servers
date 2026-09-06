/** Escape text for use in XML/SVG element content and attribute values. */
export function escapeXml(params: { text: string }): string {
  const { text } = params;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape JSON for embedding inside a `<script>` block.
 *
 * A `</script>` sequence inside the data would otherwise close the tag early
 * and turn the rest of the payload into markup.
 */
export function escapeScriptJson(params: { value: unknown }): string {
  const { value } = params;
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
