import { getIcon } from "./icons";

// Obsidian plugins use both legacy RGB components and complete CSS colors.
// Classify the value without rewriting the plugin's custom property, so its
// stylesheet and subsequent color changes retain ownership of the actual color.
export function observeCalloutStyles(root: HTMLElement): () => void {
  const update = (): void => {
    const callouts = [...root.querySelectorAll<HTMLElement>(".callout")];
    if (root.matches(".callout")) { callouts.unshift(root); }
    for (const callout of callouts) {
      const style = getComputedStyle(callout);
      const value = style.getPropertyValue("--callout-color").trim();
      const complete = value !== "" && CSS.supports("color", value);
      if (callout.hasAttribute("data-slopsidian-color-value") !== complete) {
        callout.toggleAttribute("data-slopsidian-color-value", complete);
      }
      // Only replace the host-owned glyph. Plugin-created title/icon nodes
      // keep their own DOM and lifecycle.
      const glyph = callout.querySelector<HTMLElement>(":scope > .callout-title > [data-slopsidian-callout-icon]");
      const requested = style.getPropertyValue("--callout-icon").trim().replace(/^(["'])(.*)\1$/, "$2") || "edit";
      if (glyph && glyph.dataset.slopsidianCalloutIcon !== requested && /^[a-z0-9-]+$/i.test(requested)) {
        const svg = getIcon(requested);
        if (svg) { glyph.dataset.slopsidianCalloutIcon = requested; glyph.replaceChildren(svg); }
      }
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-callout"] });
  update();
  return () => observer.disconnect();
}

