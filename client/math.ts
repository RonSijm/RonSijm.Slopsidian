import DOMPurify from "dompurify";
import katex from "katex";
import { MAX_MATH_SOURCE } from "./math-syntax";

/**
 * Renders TeX to MathML with the bundled KaTeX parser. MathML output is used on
 * purpose: it needs no KaTeX stylesheet, web fonts, network access or inline
 * style, so the existing CSP and sandbox boundaries are unchanged.
 */
export function renderMath(tex: string, display: boolean): DocumentFragment {
  if (tex.length > MAX_MATH_SOURCE) { throw new Error(`This formula exceeds ${MAX_MATH_SOURCE.toLocaleString("en-US")} characters.`); }
  const markup = katex.renderToString(tex, {
    displayMode: display, output: "mathml", throwOnError: true, trust: false, strict: "ignore",
    maxSize: 50, maxExpand: 1000,
  });
  const fragment = DOMPurify.sanitize(markup, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ["style", "script", "a", "img", "svg"],
    FORBID_ATTR: ["style", "href", "src", "srcset", "id", "name"],
  });
  if (!fragment.querySelector("math")) { throw new Error("The formula did not produce MathML."); }
  return fragment;
}

/** Replaces a placeholder's contents with rendered math, or an explicit error that retains the source. */
export function mountMath(host: HTMLElement, tex: string, display: boolean, label: string): void {
  try {
    host.replaceChildren(renderMath(tex, display));
    host.classList.add("is-rendered");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = document.createElement("span");
    status.className = "math-error reading-embed-error";
    status.setAttribute("role", "status");
    status.textContent = "Math could not be rendered: " + message.replace(/^KaTeX parse error:\s*/, "");
    const source = document.createElement("code");
    source.className = "math-source";
    source.textContent = label;
    host.replaceChildren(status, document.createTextNode(" "), source);
    host.classList.add("is-error");
  }
}
