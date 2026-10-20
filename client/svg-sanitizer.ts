// SVG is attacker-controlled markup. Files are parsed as strict XML, anything that
// can run code or reach outside the document is removed (and reported), and only
// the sanitized serialization is ever displayed, still through an <img> so the
// browser's image-document restrictions apply as a second layer.
const svgNamespace = "http://www.w3.org/2000/svg";
const xlinkNamespace = "http://www.w3.org/1999/xlink";
const blockedElements = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas", "animate", "set", "animatemotion", "animatetransform", "handler", "listener", "discard"]);
const unsafeCss = /@import|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|\\/i;
const externalUrl = /url\(\s*(?!["']?\s*#)/i;
const dataImage = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i;
export const maxSvgSide = 16384;
const maxSvgElements = 100000;

export class SvgRejectedError extends Error { constructor(message: string) { super(message); this.name = "SvgRejectedError"; } }
export interface SanitizedSvg { markup: string; width: number; height: number; removed: string[] }

function length(value: string | null): number | null {
  const match = value === null ? null : /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

export function sanitizeSvg(bytes: ArrayBuffer): SanitizedSvg {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new SvgRejectedError("The SVG is not valid UTF-8 text."); }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) { throw new SvgRejectedError("The SVG declares a DTD or entities, which are not accepted."); }
  const document_ = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = document_.documentElement;
  if (!root || document_.getElementsByTagName("parsererror").length || root.localName !== "svg" || root.namespaceURI !== svgNamespace) {
    throw new SvgRejectedError("The file is not well-formed SVG XML with an svg root element.");
  }
  const removed = new Set<string>();
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > maxSvgElements) { throw new SvgRejectedError("The SVG has too many elements to display safely."); }
  for (const element of elements) {
    if (element !== root && (element.namespaceURI !== svgNamespace || blockedElements.has(element.localName.toLowerCase()))) {
      removed.add("<" + element.localName + "> element"); element.remove(); continue;
    }
    if (element.localName === "style") {
      const css = element.textContent ?? "";
      if (unsafeCss.test(css) || externalUrl.test(css)) { removed.add("style with external or unsafe resources"); element.remove(); continue; }
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value;
      let reason: string | null = null;
      if (name.startsWith("on")) { reason = "event handler"; }
      else if (name === "href" || name === "src" || attribute.namespaceURI === xlinkNamespace || name === "xlink:href") {
        if (!(value.startsWith("#") || (element.localName === "image" && dataImage.test(value)))) { reason = "external reference"; }
      } else if (name === "style" && (unsafeCss.test(value) || externalUrl.test(value))) { reason = "style with external or unsafe resources"; }
      else if (externalUrl.test(value) || /javascript:/i.test(value)) { reason = "external resource reference"; }
      if (reason) { removed.add(reason); element.removeAttributeNode(attribute); }
    }
  }
  let width = length(root.getAttribute("width")), height = length(root.getAttribute("height"));
  if (width === null || height === null) {
    const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || box.some(value => !Number.isFinite(value)) || !(box[2]! > 0) || !(box[3]! > 0)) {
      throw new SvgRejectedError("The SVG has no usable width/height or viewBox, so it has no intrinsic size to display.");
    }
    width ??= height === null ? box[2]! : height * box[2]! / box[3]!;
    height ??= width * box[3]! / box[2]!;
  }
  if (!(width > 0) || !(height > 0) || width > maxSvgSide || height > maxSvgSide) { throw new SvgRejectedError(`The SVG size must be between 1 and ${maxSvgSide} pixels.`); }
  root.setAttribute("width", String(width)); root.setAttribute("height", String(height));
  return { markup: new XMLSerializer().serializeToString(root), width, height, removed: [...removed] };
}
