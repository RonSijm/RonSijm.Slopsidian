const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { webUrl } = require("./web-viewer-policy.cjs");

let script;
const loadScript = () => script ??= readFile(path.join(__dirname, "../src/RonSijm.Slopsidian/wwwroot/js/web-reader-extract.js"), "utf8").catch(error => { script = null; throw error; });

async function readWebArticle(viewer, endpoint, isCurrent, options = {}) {
  const contents = viewer.view.webContents;
  const navigationId = viewer.navigationId;
  const url = webUrl(contents.getURL(), endpoint, { blank: false });
  const check = () => {
    if (!isCurrent() || contents.isDestroyed() || navigationId !== viewer.navigationId || contents.getURL() !== url || !viewer.committed || contents.isLoadingMainFrame()) {
      throw new Error("The page changed or is still loading. Try again after it has loaded.");
    }
  };
  check();
  if (viewer.readerPending) { throw new Error("Article extraction is still running. Try again in a moment."); }
  viewer.readerPending = true;
  const clipping = options.format === "markdown";
  const selection = options.format === "selection";
  const page = options.format === "page";
  let timer;
  try {
    const code = await (options.loadScript ?? loadScript)();
    check();
    const result = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(1009, [{ code: code + "\n(()=>{try{return SlopsidianWebReader." + (page ? "extractWebPage" : selection ? "extractWebSelection" : clipping ? "extractWebClip" : "extractReaderArticle") + "(" + JSON.stringify(url) + ");}catch(error){return {readerError:String(error?.message||'Could not extract this article.').slice(0,1000)}}})()" }]),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Article extraction timed out. The original page is still available.")), options.timeout ?? 8000); }),
    ]);
    check();
    // Electron otherwise replaces an exception from an isolated world with a
    // generic execution error, losing the useful no-article/size explanation.
    if (typeof result?.readerError === "string") { throw new Error(result.readerError.slice(0, 1000)); }
    if (selection || page) {
      if (!result || result.url !== url || typeof result.title !== "string" || result.title.length > 1024
        || !Number.isSafeInteger(result.textLength) || result.textLength < 1 || result.textLength > (page ? 2_000_000 : 200_000)
        || typeof result.markdown !== "string" || !result.markdown.trim() || result.markdown.length > 2_000_000 || result.markdown.includes("\0")) {
        throw new Error(page ? "The page did not return valid full-page Markdown." : "The page did not return a valid text selection.");
      }
      return { url, title: result.title, markdown: result.markdown, navigationId };
    }
    if (!result || result.url !== url || typeof result.content !== "string" || !result.content || result.content.length > 1_000_000
      || typeof result.title !== "string" || result.title.length > 1024 || typeof result.byline !== "string" || result.byline.length > 1024
      || !Number.isSafeInteger(result.textLength) || result.textLength < 200 || result.textLength > 2_000_000
      || typeof result.lang !== "string" || !/^[a-z0-9-]{0,35}$/i.test(result.lang) || !["ltr", "rtl"].includes(result.dir)) {
      throw new Error("The page did not return a valid readable article.");
    }
    if (clipping) {
      if (typeof result.markdown !== "string" || !result.markdown.trim() || result.markdown.length > 2_000_000 || result.markdown.includes("\0")) { throw new Error("The page did not return valid article Markdown."); }
      return { url, title: result.title, markdown: result.markdown, navigationId };
    }
    return { ...result, navigationId };
  } finally { clearTimeout(timer); viewer.readerPending = false; }
}

module.exports = { readWebArticle };
