import DOMPurify from "dompurify";
import { readerLink } from "./web-reader-policy";

/** Inert supported content shared by article and main-document Markdown capture. */
export function sanitizeReaderContent(markup: string, sourceUrl: string): HTMLDivElement {
  const fragment = DOMPurify.sanitize(markup, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ["a", "p", "div", "span", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "strong", "b", "em", "i", "u", "s", "del", "mark", "small", "sub", "sup", "blockquote", "pre", "code", "kbd", "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "abbr", "time"],
    ALLOWED_ATTR: ["href", "alt", "title", "lang", "dir", "colspan", "rowspan", "scope", "start", "reversed", "value"],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  // Retain inert list numbering only on the elements that own that meaning.
  for (const element of fragment.querySelectorAll("[start],[reversed],[value]")) {
    if (element.tagName !== "OL") { element.removeAttribute("start"); element.removeAttribute("reversed"); }
    if (element.tagName !== "LI" || element.parentElement?.tagName !== "OL") { element.removeAttribute("value"); }
  }
  for (const element of fragment.querySelectorAll("[colspan],[rowspan]")) {
    if (element.tagName !== "TH" && element.tagName !== "TD") { element.removeAttribute("colspan"); element.removeAttribute("rowspan"); }
  }
  for (const anchor of fragment.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    const url = href ? readerLink(href, sourceUrl) : null;
    anchor.removeAttribute("href");
    if (url) { anchor.setAttribute("href", "#reader-link"); anchor.dataset.readerUrl = url; }
  }
  // Reader never fetches another copy of the article or its remote images.
  for (const image of fragment.querySelectorAll("img")) {
    const alt = image.getAttribute("alt")?.trim();
    const text = document.createElement("span"); text.textContent = alt ? `[Image: ${alt.slice(0, 1024)}]` : "";
    image.replaceWith(text);
  }
  const content = document.createElement("div"); content.append(fragment);
  return content;
}
