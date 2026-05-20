/**
 * HTML escaping helpers.
 *
 * The renderer assembles its output as plain string concatenation rather
 * than via a DOM (which would be slower and require xmldom on the HTML
 * side too). Every dynamic value must therefore go through one of these
 * before joining into the output buffer.
 */

/** Escape user-controllable text for safe inclusion in HTML element bodies. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape user-controllable text for safe inclusion as an attribute value.
 *
 *  HTML spec strictly requires only `&` and the delimiting quote, but we
 *  also escape `<` and `>` for defence-in-depth: keeps attribute payloads
 *  from looking like markup if downstream code ever extracts the value
 *  and embeds it elsewhere unescaped. */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
