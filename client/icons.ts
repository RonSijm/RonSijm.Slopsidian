import DOMPurify from "dompurify";
import { lucideIconAliases } from "./lucide-icon-aliases";

const customIcons = new Map<string, SVGSVGElement>();
const builtinIcons = new Map<string, SVGSVGElement>();
const fallbackIcons = new Map<string, SVGSVGElement>();
let loading: Promise<void> | null = null;
const aliases: Readonly<Record<string, string>> = {
  close: "x", cross: "x", sync: "refresh-cw", refresh: "refresh-cw",
  chevron: "chevron-right", "new-note": "square-pen", edit: "square-pen",
  command: "square-terminal", collapse: "chevrons-down-up", more: "ellipsis-vertical",
  outline: "list", links: "link-2", dice: "dice-5", "up-chevron-glyph": "chevron-up",
  "down-chevron-glyph": "chevron-down", "any-key": "keyboard",
};

export function addIcon(name: string, content: string): void {
  if (typeof name !== "string" || !name.trim() || typeof content !== "string") {
    throw new Error("Custom icons require a name and SVG content.");
  }
  const fragment = DOMPurify.sanitize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`, {
    RETURN_DOM_FRAGMENT: true, USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "image", "a", "script", "style"], FORBID_ATTR: ["style"],
  });
  if (fragment.childElementCount !== 1 || !(fragment.firstElementChild instanceof SVGSVGElement)) { throw new Error(`The custom icon must have one SVG root: ${name}`); }
  let svg = fragment.firstElementChild;
  if (!svg.firstElementChild) { throw new Error(`The custom icon contains no SVG elements: ${name}`); }
  if (svg.childElementCount === 1 && svg.firstElementChild instanceof SVGSVGElement) { svg = svg.firstElementChild; }
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      if (attribute.localName === "href" && !attribute.value.startsWith("#")) {
        throw new Error(`Custom icons cannot reference external resources: ${name}`);
      }
    }
  }
  customIcons.set(name, svg);
}

export function loadBuiltinIcons(): Promise<void> {
  loading ??= (async () => {
    const catalogs = await Promise.all(["lucide-icons.svg", "icons.svg"].map(async file => {
      const response = await fetch(new URL(file, document.baseURI));
      if (!response.ok) { throw new Error(`Cannot load the application icon catalog ${file}: HTTP ${response.status}.`); }
      const catalog = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
      if (catalog.querySelector("parsererror")) { throw new Error(`The application icon catalog is invalid SVG: ${file}`); }
      if (!catalog.querySelector("symbol[id]")) { throw new Error(`The application icon catalog contains no icons: ${file}`); }
      return { file, catalog };
    }));
    const icons = new Map<string, SVGSVGElement>();
    const fallbacks = new Map<string, SVGSVGElement>();
    for (const { file, catalog } of catalogs) {
      for (const symbol of catalog.querySelectorAll("symbol[id]")) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", symbol.getAttribute("viewBox") ?? "0 0 24 24");
        for (const [attribute, value] of Object.entries({
          width: "24", height: "24", fill: "none", stroke: "currentColor",
          "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round",
        })) { svg.setAttribute(attribute, value); }
        svg.append(...[...symbol.childNodes].map(child => document.importNode(child, true)));
        (file === "lucide-icons.svg" ? icons : fallbacks).set(symbol.id, svg);
      }
    }
    if (!icons.size) { throw new Error("The application icon catalog contains no icons."); }
    for (const [id, svg] of icons) { builtinIcons.set(id, svg); }
    for (const [id, svg] of fallbacks) { fallbackIcons.set(id, svg); }
  })();
  return loading;
}

export function getIconIds(): string[] {
  return [...new Set([...builtinIcons.keys()].map(name => `lucide-${name}`).concat([...fallbackIcons.keys()], [...customIcons.keys()]))];
}

export function removeIcon(name: string): void { customIcons.delete(name); }

export function getIcon(name: string): SVGSVGElement | null {
  const explicit = name.startsWith("lucide-"), id = explicit ? name.slice(7) : name;
  const legacy = !explicit && Object.hasOwn(aliases, id) ? aliases[id] : id;
  const canonical = builtinIcons.has(legacy) ? legacy : Object.hasOwn(lucideIconAliases, legacy) ? lucideIconAliases[legacy] : legacy;
  // An explicit Lucide name always belongs to that catalog, including when a
  // plugin or our legacy sprite happens to register the same text identifier.
  const custom = !explicit ? customIcons.get(name) : undefined;
  const builtin = builtinIcons.get(canonical);
  const template = custom ?? builtin ?? (!explicit ? fallbackIcons.get(id) : undefined);
  if (template) {
    const svg = template.cloneNode(true);
    if (!(svg instanceof SVGSVGElement)) { throw new Error(`Invalid registered SVG icon: ${name}`); }
    svg.classList.add("svg-icon");
    if (!custom && builtin) { svg.classList.add(`lucide-${canonical}`); }
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  return null;
}

/** A sprite reference is also usable before the fetched icon catalogs are ready. */
export function iconSpriteReference(name: string): string {
  const explicit = name.startsWith("lucide-"), id = explicit ? name.slice(7) : name;
  const legacy = !explicit && Object.hasOwn(aliases, id) ? aliases[id] : id;
  const canonical = builtinIcons.has(legacy) ? legacy : Object.hasOwn(lucideIconAliases, legacy) ? lucideIconAliases[legacy] : legacy;
  return !explicit && !builtinIcons.has(canonical) && fallbackIcons.has(id)
    ? `icons.svg#${id}` : `lucide-icons.svg#${canonical}`;
}

export function icon(name: string): SVGSVGElement {
  const registered = getIcon(name);
  if (registered) { return registered; }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("svg-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", iconSpriteReference(name));
  svg.appendChild(use);
  return svg;
}

export function setIcon(element: HTMLElement, name: string): void { element.replaceChildren(icon(name)); }

export function iconButton(name: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "clickable-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(icon(name));
  button.addEventListener("click", action);
  return button;
}
