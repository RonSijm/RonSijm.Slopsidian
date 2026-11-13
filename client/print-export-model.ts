export const MAX_PRINT_SOURCE = 1_048_576;
export const PRINT_PAGE_SIZES = ["A4", "Letter", "Legal"] as const;
export const PRINT_MARGINS = { normal: 12.7, minimal: 6.35, none: 0 } as const;
export interface PrintExportOptions {
  pageSize: typeof PRINT_PAGE_SIZES[number];
  landscape: boolean;
  includeName: boolean;
  margin: keyof typeof PRINT_MARGINS;
}
export const DEFAULT_PRINT_OPTIONS: PrintExportOptions = { pageSize: "A4", landscape: false, includeName: true, margin: "normal" };

export function validatePrintOptions(value: PrintExportOptions): PrintExportOptions {
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["pageSize", "landscape", "includeName", "margin"].includes(key))
    || !PRINT_PAGE_SIZES.includes(value.pageSize) || typeof value.landscape !== "boolean" || typeof value.includeName !== "boolean"
    || !Object.hasOwn(PRINT_MARGINS, value.margin)) { throw new Error("Choose a supported paper size, orientation and margin."); }
  return { pageSize: value.pageSize, landscape: value.landscape, includeName: value.includeName, margin: value.margin };
}

export function printPageRule(value: PrintExportOptions): string {
  const options = validatePrintOptions(value);
  return `@page { size: ${options.pageSize} ${options.landscape ? "landscape" : "portrait"}; margin: ${PRINT_MARGINS[options.margin]}mm; }`;
}

/** A suggested filename, never a renderer-supplied destination. The native picker owns the final path. */
export function suggestedPdfName(title: string): string {
  let name = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").trim().replace(/[. ]+$/, "").slice(0, 160);
  if (!name || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) { name = "Note" + (name ? " " + name : ""); }
  return name + ".pdf";
}
