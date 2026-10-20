// Bundled separately for the native process; never injected into a web page.
const { FiltersEngine, Request } = require("@ghostery/adblocker");
exports.parse = text => {
  const engine = FiltersEngine.parse(text, {
    loadNetworkFilters: true, loadExceptionFilters: true,
    loadCosmeticFilters: false, loadCSPFilters: false, enableHtmlFiltering: false,
  });
  return details => engine.match(Request.fromRawDetails({
    url: details.url, type: details.resourceType || "other", sourceUrl: details.referrer || "",
    requestId: String(details.id ?? ""), tabId: details.webContentsId,
  })).match;
};
