const searchEngines: Record<string, string> = {
  duckduckgo: "https://duckduckgo.com/?q=%s", brave: "https://search.brave.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s", google: "https://www.google.com/search?q=%s",
};

export function webAddress(value: string, options: Record<string, unknown> = {}): string {
  const input = value.trim();
  if (!input || input === "about:blank") { return "about:blank"; }
  if (input.length > 8192 || /[\u0000-\u001f\u007f]/.test(input)) { throw new Error("Enter a valid web address or search query."); }
  let target = input;
  if (!/^https?:\/\//i.test(input)) {
    if (/^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i.test(input)) { throw new Error("Web viewer only opens HTTP and HTTPS addresses."); }
    if (/^(?:localhost(?::\d+)?|[^\s/?#]+\.[^\s/?#]+)(?:[/?#].*)?$/i.test(input)) {
      target = "https://" + input;
    } else {
      const engine = options.searchEngine === "custom" && typeof options.customSearchEngine === "string"
        ? options.customSearchEngine : searchEngines[String(options.searchEngine)] ?? searchEngines.duckduckgo;
      if (!engine.includes("%s")) { throw new Error("The custom search address must contain %s for the query."); }
      target = engine.replace("%s", encodeURIComponent(input));
    }
  }
  const url = new URL(target);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Web viewer only opens HTTP and HTTPS addresses without embedded credentials.");
  }
  return url.href;
}
