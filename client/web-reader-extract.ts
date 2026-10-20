import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import { articleMarkdown, selectionMarkdown } from "./web-clip-markdown";
import { READER_MAX_CONTENT, READER_MAX_ELEMENTS, READER_MAX_SOURCE, READER_MIN_TEXT, readerLink, type ReaderArticle } from "./web-reader-policy";

/** Executed only in a separate world in the sandboxed website renderer. */
export function extractReaderArticle(sourceUrl: string): ReaderArticle {
  if (readerLink(sourceUrl, sourceUrl) !== sourceUrl) { throw new Error("Open an HTTP(S) page before using Reader."); }
  if (document.getElementsByTagName("*").length > READER_MAX_ELEMENTS || !document.documentElement || document.documentElement.outerHTML.length > READER_MAX_SOURCE) {
    throw new Error("This page is too large for Reader. The original page is still available.");
  }
  const copy = document.cloneNode(true) as Document;
  copy.querySelectorAll("script,style,link,iframe,object,embed,form,template,svg,math,noscript,button,input,select,textarea,base").forEach(node => node.remove());
  const base = copy.createElement("base"); base.href = sourceUrl; copy.head.prepend(base);
  const article = new Readability(copy, { maxElemsToParse: READER_MAX_ELEMENTS, charThreshold: READER_MIN_TEXT, disableJSONLD: true }).parse();
  if (!article?.content) { throw new Error("No readable article was found on this page. The original page is still available."); }
  const fragment = DOMPurify.sanitize(article.content, {
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
  const textLength = content.textContent?.trim().length ?? 0;
  if (textLength < READER_MIN_TEXT) { throw new Error("No readable article was found on this page. The original page is still available."); }
  if (content.innerHTML.length > READER_MAX_CONTENT) { throw new Error("This article is too large for Reader. The original page is still available."); }
  return {
    url: sourceUrl, title: (article.title || document.title || "Untitled article").slice(0, 1024),
    byline: typeof article.byline === "string" ? article.byline.slice(0, 1024) : "",
    content: content.innerHTML, textLength,
    lang: typeof article.lang === "string" && /^[a-z0-9-]{0,35}$/i.test(article.lang) ? article.lang : "",
    dir: article.dir === "rtl" ? "rtl" : "ltr",
  };
}

export function extractWebClip(sourceUrl: string): ReaderArticle & { markdown: string } {
  const article = extractReaderArticle(sourceUrl);
  const content = document.createElement("div");
  content.innerHTML = article.content;
  return { ...article, markdown: articleMarkdown(article, content) };
}

/** Selection is read once; it never enters the editor as website markup. */
export function extractWebSelection(sourceUrl: string): { url: string; title: string; markdown: string; textLength: number } {
  if (readerLink(sourceUrl, sourceUrl) !== sourceUrl) { throw new Error("Open an HTTP(S) page before saving a selection."); }
  if (document.getElementsByTagName("*").length > READER_MAX_ELEMENTS || !document.documentElement || document.documentElement.outerHTML.length > READER_MAX_SOURCE) {
    throw new Error("This page is too large for selection capture.");
  }
  const selection = window.getSelection();
  const unsupported = 'input,textarea,select,iframe,frame,object,embed,[contenteditable]:not([contenteditable="false"])';
  if (document.activeElement?.closest(unsupported) || !selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    throw new Error("Select text in the original main page. Selections in controls or frames are unavailable.");
  }
  const range = selection.getRangeAt(0);
  for (const node of [range.startContainer, range.endContainer]) {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (node.getRootNode() !== document || element?.closest(unsupported)) {
      throw new Error("Select text in the original main page. Selections in controls or frames are unavailable.");
    }
  }
  const text = selection.toString(), title = (document.title || "Untitled page").slice(0, 1024);
  return { url: sourceUrl, title, markdown: selectionMarkdown(title, sourceUrl, text), textLength: text.length };
}
