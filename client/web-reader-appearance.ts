// System font stacks and bounded line lengths work offline inside the Reader CSP.
export const READER_FONTS = { serif: "Georgia,serif", "sans-serif": "system-ui,sans-serif", monospace: "Consolas,monospace", custom: '"Georgia",serif' } as const;
export const READER_WIDTHS = { narrow: "56ch", standard: "72ch", wide: "96ch", custom: "72ch" } as const;
export const READER_TYPOGRAPHY = { fontSize: { minimum: 14, maximum: 32, default: 19 }, lineHeight: { minimum: 1.2, maximum: 2.4, default: 1.7 }, paragraphSpacing: { minimum: 0, maximum: 3, default: 1 }, letterSpacing: { minimum: 0, maximum: 0.2, default: 0 }, customWidth: { minimum: 40, maximum: 120, default: 72 } } as const;

export interface ReaderAppearance {
  readerFont: keyof typeof READER_FONTS;
  readerWidth: keyof typeof READER_WIDTHS;
  readerFontSize: number;
  readerLineHeight: number;
  readerParagraphSpacing: number;
  readerLetterSpacing: number;
  readerCustomWidth: number;
  readerCustomFont: string;
}

/** Also serialized into the opaque frame so both JS boundaries use the same policy. */
export function readerFontName(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) { throw new Error("Choose a Reader custom font family of 1–100 characters, using a single local family name."); }
  const name = value.replace(/^ +| +$/g, "");
  if (!/\p{L}/u.test(name) || !/^[\p{L}\p{M}\p{N} ._'()-]+$/u.test(name)) {
    throw new Error("Choose a Reader custom font family using letters, numbers, spaces, periods, underscores, apostrophes, parentheses or hyphens.");
  }
  return name;
}

export function readerAppearance(value: { readerFont?: unknown; readerWidth?: unknown; readerFontSize?: unknown; readerLineHeight?: unknown; readerParagraphSpacing?: unknown; readerLetterSpacing?: unknown; readerCustomWidth?: unknown; readerCustomFont?: unknown } = {}): ReaderAppearance {
  const readerFont = value.readerFont === undefined ? "serif" : value.readerFont;
  const readerWidth = value.readerWidth === undefined ? "standard" : value.readerWidth;
  const readerFontSize = value.readerFontSize === undefined ? READER_TYPOGRAPHY.fontSize.default : value.readerFontSize;
  const readerLineHeight = value.readerLineHeight === undefined ? READER_TYPOGRAPHY.lineHeight.default : value.readerLineHeight;
  const readerParagraphSpacing = value.readerParagraphSpacing === undefined ? READER_TYPOGRAPHY.paragraphSpacing.default : value.readerParagraphSpacing;
  const readerLetterSpacing = value.readerLetterSpacing === undefined ? READER_TYPOGRAPHY.letterSpacing.default : value.readerLetterSpacing;
  const readerCustomWidth = value.readerCustomWidth === undefined ? READER_TYPOGRAPHY.customWidth.default : value.readerCustomWidth;
  const readerCustomFont = readerFontName(value.readerCustomFont === undefined ? "Georgia" : value.readerCustomFont);
  if (typeof readerFont !== "string" || !Object.hasOwn(READER_FONTS, readerFont)
    || typeof readerWidth !== "string" || !Object.hasOwn(READER_WIDTHS, readerWidth)) {
    throw new Error("Choose a supported Reader font and article width in Web viewer settings.");
  }
  if (typeof readerFontSize !== "number" || !Number.isInteger(readerFontSize) || readerFontSize < READER_TYPOGRAPHY.fontSize.minimum || readerFontSize > READER_TYPOGRAPHY.fontSize.maximum
    || typeof readerLineHeight !== "number" || readerLineHeight !== Math.round(readerLineHeight * 10) / 10 || readerLineHeight < READER_TYPOGRAPHY.lineHeight.minimum || readerLineHeight > READER_TYPOGRAPHY.lineHeight.maximum) {
    throw new Error("Choose a Reader font size from 14 to 32 whole pixels and line spacing from 1.2 to 2.4 in steps of 0.1.");
  }
  if (typeof readerParagraphSpacing !== "number" || readerParagraphSpacing !== Math.round(readerParagraphSpacing * 10) / 10 || readerParagraphSpacing < READER_TYPOGRAPHY.paragraphSpacing.minimum || readerParagraphSpacing > READER_TYPOGRAPHY.paragraphSpacing.maximum) {
    throw new Error("Choose Reader paragraph spacing from 0 to 3 em in steps of 0.1.");
  }
  if (typeof readerLetterSpacing !== "number" || readerLetterSpacing !== Math.round(readerLetterSpacing * 100) / 100 || readerLetterSpacing < READER_TYPOGRAPHY.letterSpacing.minimum || readerLetterSpacing > READER_TYPOGRAPHY.letterSpacing.maximum) {
    throw new Error("Choose Reader letter spacing from 0 to 0.2 em in steps of 0.01.");
  }
  if (typeof readerCustomWidth !== "number" || !Number.isInteger(readerCustomWidth) || readerCustomWidth < READER_TYPOGRAPHY.customWidth.minimum || readerCustomWidth > READER_TYPOGRAPHY.customWidth.maximum) {
    throw new Error("Choose a Reader custom width from 40 to 120 whole characters (ch).");
  }
  return { readerFont, readerWidth, readerFontSize, readerLineHeight, readerParagraphSpacing, readerLetterSpacing, readerCustomWidth, readerCustomFont } as ReaderAppearance;
}
