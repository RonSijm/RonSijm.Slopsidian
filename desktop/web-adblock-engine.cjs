// Bundled separately for the native process; never injected into a web page.
const { FiltersEngine, Request, parseFilters } = require("@ghostery/adblocker");

// Filter-list scripts and extended selectors are never executed: only network rules and static hide rules are loaded.
const config = cosmetic => ({
  loadNetworkFilters: true, loadExceptionFilters: true,
  loadCosmeticFilters: cosmetic, loadGenericCosmeticsFilters: cosmetic,
  loadCSPFilters: false, enableHtmlFiltering: false, loadExtendedSelectors: false, loadPreprocessors: false,
});
const COSMETIC_STYLE_LIMIT = 1_000_000;
const DOM_LIMITS = { classes: 2000, ids: 1000, hrefs: 500, text: 256 };

function words(values, limit) {
  if (!Array.isArray(values)) { return []; }
  const result = new Set();
  for (const value of values) {
    if (typeof value === "string" && value.length > 0 && value.length <= DOM_LIMITS.text && !/[\u0000-\u001f]/.test(value)) { result.add(value); }
    if (result.size >= limit) { break; }
  }
  return [...result];
}

/** Summarizes a list without building an engine; scriptlets and extended selectors are counted as unsupported. */
exports.inspect = text => {
  const parsed = parseFilters(text, config(true));
  const stats = { network: 0, exceptions: 0, cosmetic: 0, unsupported: 0, ignored: 0 };
  for (const filter of parsed.networkFilters) { if (filter.isException()) { stats.exceptions++; } else { stats.network++; } }
  for (const filter of parsed.cosmeticFilters) {
    if (filter.isScriptInject() || filter.isExtended()) { stats.unsupported++; } else { stats.cosmetic++; }
  }
  stats.ignored = parsed.notSupportedFilters.length;
  return stats;
};

exports.compile = (texts, { cosmetic = false } = {}) => {
  const engine = FiltersEngine.parse(texts.join("\n"), config(cosmetic));
  const match = details => engine.match(Request.fromRawDetails({
    url: details.url, type: details.resourceType || "other", sourceUrl: details.referrer || "",
    requestId: String(details.id ?? ""), tabId: details.webContentsId,
  })).match;
  match.cosmetics = cosmetic ? (url, dom) => {
    const request = Request.fromRawDetails({ url, type: "mainFrame" });
    const result = engine.getCosmeticsFilters({
      url, hostname: request.hostname, domain: request.domain || "",
      classes: words(dom?.classes, DOM_LIMITS.classes), ids: words(dom?.ids, DOM_LIMITS.ids), hrefs: words(dom?.hrefs, DOM_LIMITS.hrefs),
      getBaseRules: true, getInjectionRules: false, getExtendedRules: false, getRulesFromDOM: Boolean(dom), getRulesFromHostname: true,
    });
    const styles = typeof result.styles === "string" ? result.styles : "";
    if (styles.length > COSMETIC_STYLE_LIMIT) { throw new Error("The cosmetic filters for this page exceed the supported size."); }
    return { styles, rules: styles ? [...styles.matchAll(/([^{}]+)\{/g)].reduce((total, block) => total + block[1].split(",\n").length, 0) : 0 };
  } : null;
  return match;
};

exports.parse = (text, options) => exports.compile([text], options);
