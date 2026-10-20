// Dots only separate alphanumeric-led segments, so ".." and trailing dots (Windows strips them) cannot occur.
const PLUGIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/;
// Windows resolves a reserved device basename with any extension (for example con.txt or nul.a.b) to a device.
const RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|COM[0-9\u00b2\u00b3\u00b9]|LPT[0-9\u00b2\u00b3\u00b9])(?:$|\.)/i;

export const PLUGIN_ID_GUIDANCE = "Invalid plugin identifier: use at most 128 letters, digits, hyphens or underscores, optionally separated by single dots, without Windows reserved device names.";

export function isPluginId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && PLUGIN_ID.test(value) && !RESERVED_BASENAME.test(value);
}

/** Escapes a literal plugin id for use in a CSS selector (for example `#id` or `.id`). */
export function pluginIdSelector(id: string): string {
  return CSS.escape(id);
}

/** Selects an element by the literal value of a data attribute, never interpreting id punctuation as CSS syntax. */
export function pluginAttributeSelector(attribute: string, id: string): string {
  return `[${attribute}="${CSS.escape(id)}"]`;
}
