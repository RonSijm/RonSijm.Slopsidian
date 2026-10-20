import { articleMarkdown } from "./web-clip-markdown";
import { sanitizeReaderContent } from "./web-reader-sanitize";
import { READER_MAX_CONTENT, READER_MAX_ELEMENTS, READER_MAX_SOURCE, readerLink, type ReaderArticle } from "./web-reader-policy";

const excluded = 'script,style,link,iframe,frame,object,embed,form,template,svg,math,noscript,button,input,select,textarea,datalist,option,optgroup,base,canvas,dialog,audio,video,source,track,[contenteditable]:not([contenteditable="false"])';
export function pageStyleHidden(style: Pick<CSSStyleDeclaration, "display" | "visibility" | "opacity" | "contentVisibility">): boolean {
  return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || style.contentVisibility === "hidden";
}
/** One bounded snapshot of the loaded main document; no scrolling or fetches. */
export function extractWebPage(sourceUrl: string): { url: string; title: string; markdown: string; textLength: number } {
  if (readerLink(sourceUrl, sourceUrl) !== sourceUrl) { throw new Error("Open an HTTP(S) page before using Save page."); }
  if (!document.documentElement || !document.body || document.getElementsByTagName("*").length > READER_MAX_ELEMENTS
    || document.documentElement.outerHTML.length > READER_MAX_SOURCE) { throw new Error("This page is too large for full-page Markdown capture."); }
  if ([document.documentElement, document.body].some(node => node.matches(excluded) || node.hasAttribute("hidden")
    || node.getAttribute("aria-hidden") === "true" || pageStyleHidden(getComputedStyle(node)))) {
    throw new Error("No supported visible page content was found.");
  }
  const copy = document.cloneNode(true) as Document, body = copy.body;
  const originals = Array.from(document.body.querySelectorAll("*")), clones = Array.from(body.querySelectorAll("*"));
  if (originals.length !== clones.length) { throw new Error("The page changed while capturing its content. Reopen Save page."); }
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index], clone = clones[index];
    if (!body.contains(clone)) { continue; }
    if (original.matches(excluded)) { clone.remove(); continue; }
    const hidden = original.hasAttribute("hidden") || original.getAttribute("aria-hidden") === "true" || pageStyleHidden(getComputedStyle(original));
    if (hidden) {
      if (clone.matches("thead,tbody,tfoot,tr,th,td") && clone.closest("table")) {
        throw new Error("A table with hidden rows or cells cannot be preserved as full-page Markdown.");
      }
      clone.remove(); continue;
    }
    if (original.tagName === "OL" && getComputedStyle(original).listStyleType !== "decimal") {
      throw new Error("This page's ordered-list numbering cannot be preserved as Markdown.");
    }
    if (original.tagName === "A") {
      const url = readerLink((original as HTMLAnchorElement).href, sourceUrl);
      if (url) { clone.setAttribute("href", url); } else { clone.removeAttribute("href"); }
    }
    if (["HEADER", "NAV", "ASIDE", "MAIN", "FOOTER"].includes(original.tagName)) {
      const block = copy.createElement("div"); block.append(...clone.childNodes); clone.replaceWith(block);
    }
  }
  const content = sanitizeReaderContent(body.innerHTML, sourceUrl), textLength = content.textContent?.trim().length ?? 0;
  if (!textLength) { throw new Error("No supported visible page content was found."); }
  if (content.innerHTML.length > READER_MAX_CONTENT || textLength > READER_MAX_SOURCE) { throw new Error("This page's content is too large to save as Markdown."); }
  const title = (document.title || "Untitled page").slice(0, 1024);
  const page: ReaderArticle = { url: sourceUrl, title, byline: "", content: content.innerHTML, textLength, lang: "", dir: "ltr" };
  return { url: sourceUrl, title, markdown: articleMarkdown(page, content), textLength };
}
